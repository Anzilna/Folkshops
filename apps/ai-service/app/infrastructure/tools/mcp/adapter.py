"""
Implements ToolProvider on top of mcp/client.py. ToolRegistry and every
caller above it depend only on ToolProvider/ToolSession, so replacing MCP
with a direct HTTP adapter later means writing one new class here.

Never raises for a tool or transport failure: an unreachable core-api
yields a session with no tools (the agent carries on with knowledge_search
only), and a failed call comes back as a FAILED ToolOutcome with an
error_code the executor knows how to treat (retry a read, mark a mutation
UNKNOWN, ...). A circuit breaker per surface stops a down core-api from
being hit on every run.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.domain.interfaces.tool_provider import ActorContext, ToolOutcome, ToolStatus
from app.infrastructure.resilience import CircuitBreaker
from app.infrastructure.tools.mcp.client import HttpStatusTracker, MCPError, httpx2, open_mcp_client

logger = logging.getLogger(__name__)

# Server error codes from core-api's src/mcp/mcp-http.ts (toolError()).
_SERVER_ERROR_CODES = {"not_found", "invalid_argument", "forbidden", "conflict", "internal"}
# Outer guard on top of the per-call read timeout, for anything the
# transport's own timeout doesn't cover.
_TIMEOUT_GRACE_S = 2.0


class _UnavailableSession:
    def __init__(self, reason: str):
        self.reason = reason

    def available(self) -> dict[str, dict]:
        return {}

    async def call(self, name: str, arguments: dict, timeout_s: float) -> ToolOutcome:
        return ToolOutcome(tool_name=name, status=ToolStatus.FAILED, error_code="unavailable", message=self.reason)


class _McpSession:
    def __init__(self, client, tools: dict[str, dict], breaker: CircuitBreaker, tracker: HttpStatusTracker):
        self._client = client
        self._tools = tools
        self._breaker = breaker
        self._tracker = tracker

    def available(self) -> dict[str, dict]:
        return self._tools

    async def call(self, name: str, arguments: dict, timeout_s: float) -> ToolOutcome:
        try:
            result = await asyncio.wait_for(
                self._client.call_tool(name, arguments, read_timeout_seconds=timeout_s),
                timeout_s + _TIMEOUT_GRACE_S,
            )
        except TimeoutError:
            self._breaker.record_failure()
            return ToolOutcome(
                tool_name=name, status=ToolStatus.FAILED, error_code="timeout", message="The tool timed out"
            )
        except httpx2.ConnectError:
            # Never reached core-api, so definitely not applied.
            self._breaker.record_failure()
            return ToolOutcome(
                tool_name=name, status=ToolStatus.FAILED, error_code="unavailable", message="Tool service unreachable"
            )
        except MCPError as exc:
            status = self._tracker.last_status
            if self._tracker.auth_rejected:
                # Rejected by core-api's guards, which run before any tool
                # code — so definitely not applied.
                return ToolOutcome(
                    tool_name=name, status=ToolStatus.FAILED, error_code="forbidden", message="Not authorized"
                )
            if status is not None and status >= 500:
                self._breaker.record_failure()
                return ToolOutcome(
                    tool_name=name, status=ToolStatus.FAILED, error_code="transport", message="Tool server error"
                )
            # A JSON-RPC level error on a 2xx response (e.g. the server's
            # own argument validation) — a definite rejection.
            return ToolOutcome(
                tool_name=name, status=ToolStatus.FAILED, error_code="invalid_argument", message=exc.message[:300]
            )
        except Exception as exc:
            self._breaker.record_failure()
            logger.warning("mcp call %s failed: %s", name, type(exc).__name__)
            return ToolOutcome(
                tool_name=name, status=ToolStatus.FAILED, error_code="transport", message="Tool call failed in transit"
            )

        self._breaker.record_success()
        body = _result_body(result)
        if result.is_error:
            code = body.get("error_code") if isinstance(body, dict) else None
            message = body.get("message") if isinstance(body, dict) else None
            if code not in _SERVER_ERROR_CODES:
                # The SDK's own input validation reports errors as plain text.
                code = "invalid_argument"
                message = _first_text(result)
            return ToolOutcome(tool_name=name, status=ToolStatus.FAILED, error_code=code, message=(message or "")[:300])
        if not isinstance(body, dict):
            return ToolOutcome(
                tool_name=name,
                status=ToolStatus.FAILED,
                error_code="bad_response",
                message="Tool returned an unexpected shape",
            )
        return ToolOutcome(tool_name=name, status=ToolStatus.SUCCEEDED, data=body)


def _first_text(result) -> str:
    for item in result.content or []:
        text = getattr(item, "text", None)
        if text:
            return text
    return ""


def _result_body(result):
    if result.structured_content is not None:
        return result.structured_content
    text = _first_text(result)
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        return None


class McpToolProvider:
    def __init__(self, base_url: str, service_token: str, *, read_timeout_s: float = 10.0):
        self._base_url = base_url.rstrip("/")
        self._service_token = service_token
        self._read_timeout_s = read_timeout_s
        self._breakers = {"staff": CircuitBreaker(), "customer": CircuitBreaker()}

    @asynccontextmanager
    async def session(self, actor: ActorContext) -> AsyncIterator[_McpSession | _UnavailableSession]:
        surface = actor.actor_type
        breaker = self._breakers[surface]
        if actor.access_token is None:
            yield _UnavailableSession("no user token")
            return
        if not breaker.allow():
            yield _UnavailableSession("circuit open")
            return

        url = f"{self._base_url}/internal/mcp/{surface}"
        tracker = HttpStatusTracker()
        opened = open_mcp_client(
            url,
            service_token=self._service_token,
            user_token=actor.access_token.get_secret_value(),
            read_timeout_s=self._read_timeout_s,
            tracker=tracker,
        )
        try:
            client = await opened.__aenter__()
            listing = await client.list_tools()
        except BaseException as exc:
            if isinstance(exc, asyncio.CancelledError):
                raise
            await _safe_exit(opened)
            if tracker.auth_rejected:
                # core-api is up and said no to THIS caller (expired token,
                # wrong service secret). Not a dependency failure: tripping
                # the shared breaker here would cut every other user off.
                logger.warning("mcp %s rejected credentials: status=%s", surface, tracker.last_status)
                yield _UnavailableSession("unauthorized")
                return
            breaker.record_failure()
            logger.warning("mcp %s unavailable: %s", surface, type(exc).__name__)
            yield _UnavailableSession("unavailable")
            return

        breaker.record_success()
        tools = {t.name: t.input_schema for t in listing.tools}
        try:
            yield _McpSession(client, tools, breaker, tracker)
        finally:
            await _safe_exit(opened)


async def _safe_exit(cm) -> None:
    try:
        await cm.__aexit__(None, None, None)
    except Exception:
        logger.debug("mcp client close failed", exc_info=True)
