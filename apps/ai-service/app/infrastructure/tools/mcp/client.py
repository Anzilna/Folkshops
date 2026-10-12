"""
The only module that imports the MCP SDK. Opens a Streamable HTTP MCP
client against one of core-api's /internal/mcp/{staff|customer} endpoints,
carrying both credentials core-api requires: the internal service token
(proves the caller is ai-service) and the user's own bearer token (decides
who is acting and for which store).

mode="legacy" forces the classic initialize handshake. The Python SDK
defaults to probing the newer 2026-07-28 protocol first; core-api runs the
TypeScript SDK's handshake-era server, so skipping the probe saves a
round-trip and an expected failure on every run.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError

INTERNAL_SERVICE_HEADER = "X-Internal-Service-Token"
CONNECT_TIMEOUT_S = 3.0


class HttpStatusTracker:
    """
    The SDK reports any non-2xx HTTP response as a generic MCPError, so a
    401 (bad/expired user token) looks the same as a 500. The adapter must
    tell them apart — an auth rejection is the caller's problem, not
    core-api being down, and must not trip the shared circuit breaker — so
    this records the status of the last HTTP response seen.
    """

    def __init__(self) -> None:
        self.last_status: int | None = None

    async def __call__(self, response: httpx2.Response) -> None:
        self.last_status = response.status_code

    @property
    def auth_rejected(self) -> bool:
        return self.last_status in (401, 403)


@asynccontextmanager
async def open_mcp_client(
    url: str, *, service_token: str, user_token: str, read_timeout_s: float, tracker: HttpStatusTracker
) -> AsyncIterator[Client]:
    http = httpx2.AsyncClient(
        headers={INTERNAL_SERVICE_HEADER: service_token, "Authorization": f"Bearer {user_token}"},
        timeout=httpx2.Timeout(read_timeout_s, connect=CONNECT_TIMEOUT_S),
        event_hooks={"response": [tracker]},
    )
    async with http, Client(streamable_http_client(url, http_client=http), mode="legacy", cache=None) as client:
        yield client


__all__ = ["open_mcp_client", "HttpStatusTracker", "MCPError", "httpx2"]
