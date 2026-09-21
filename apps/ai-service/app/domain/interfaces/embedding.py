from typing import Protocol


class EmbeddingProvider(Protocol):
    """
    Application/RAG code must only ever depend on this Protocol — never
    import an embedding SDK directly (see docs/decisions/0011).
    """

    @property
    def dimensions(self) -> int:
        """Declared output width — EmbeddingRouter checks this against the schema's fixed vector(N) column at boot."""
        ...

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...
