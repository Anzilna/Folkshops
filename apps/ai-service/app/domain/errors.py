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
    pass


class ToolExecutionError(AppError):
    pass


class RetrievalError(AppError):
    pass


class UnsupportedDocumentType(AppError):
    pass
