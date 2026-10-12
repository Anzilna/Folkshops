"""
Structured application errors (spec rule 27). api/routes/* catch these and
map to HTTP responses; a provider-specific exception (an openai.APIError, an
asyncpg.PostgresError, ...) must never leak past infrastructure/ — see each
adapter's own try/except.
"""


class AppError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class DocumentNotFound(AppError):
    pass


class TenantAccessDenied(AppError):
    pass


class EmbeddingProviderError(AppError):
    pass


class VectorStoreError(AppError):
    pass


class LLMProviderError(AppError):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        # True for rate limits, timeouts and vendor 5xx — the same request
        # may succeed later or on the fallback model. False for a bad
        # request/auth error, where retrying only burns quota.
        self.retryable = retryable


class ToolExecutionError(AppError):
    pass


class ConversationBusy(AppError):
    """Another agent run is already working on this conversation."""


class AgentBudgetExceeded(AppError):
    """The tenant's daily agent-run budget is used up."""


class PendingActionError(AppError):
    """A confirm/cancel on a pending action that has expired or was already handled."""


class PendingActionNotFound(PendingActionError):
    """No such pending action for this actor (also what another actor's action looks like)."""


class RetrievalError(AppError):
    pass


class UnsupportedDocumentType(AppError):
    pass
