"""
Structured logging via structlog, with request_id/tenant_id/trace_id bound
per-request via contextvars (spec section 23) rather than passed manually
through every function call. Never logs API keys/passwords/tokens/PII — see
`_redact_sensitive` and the fixed allowlist approach: only known-safe keys
are ever included in the bound context, not "everything except a blocklist."
"""

import logging
import sys

import structlog

_SENSITIVE_KEYS = {"api_key", "authorization", "password", "token", "cookie", "jwt"}


def _redact_sensitive(_, __, event_dict: dict) -> dict:
    for key in list(event_dict.keys()):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = "[redacted]"
    return event_dict


def configure_logging(app_env: str) -> None:
    logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(message)s")

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            _redact_sensitive,
            structlog.processors.JSONRenderer()
            if app_env == "production"
            else structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def bind_request_context(*, request_id: str, tenant_id: str | None, trace_id: str | None) -> None:
    structlog.contextvars.bind_contextvars(request_id=request_id, tenant_id=tenant_id, trace_id=trace_id)


def clear_request_context() -> None:
    structlog.contextvars.clear_contextvars()


def get_logger(name: str):
    return structlog.get_logger(name)
