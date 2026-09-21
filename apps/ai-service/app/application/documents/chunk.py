"""
Chunker is a Protocol, not a class hard-wired into the ingestion pipeline
(spec section 6: "Do not hard-code chunking logic inside the RAG pipeline").
RecursiveTextChunker is the one Phase 1 implementation.
"""

from typing import Protocol
from uuid import UUID, uuid4

from app.domain.models.chunk import Chunk

_SEPARATORS = ["\n\n", "\n", ". ", " "]


class Chunker(Protocol):
    def chunk(self, text: str, document_id: UUID, tenant_id: UUID) -> list[Chunk]: ...


class RecursiveTextChunker:
    """Splits on the largest available separator first, falling back to smaller ones, then hard character limits."""

    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 150):
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap

    def _split(self, text: str, separators: list[str]) -> list[str]:
        if len(text) <= self._chunk_size:
            return [text] if text.strip() else []
        if not separators:
            step = max(self._chunk_size - self._chunk_overlap, 1)
            return [text[i : i + self._chunk_size] for i in range(0, len(text), step)]

        sep, rest = separators[0], separators[1:]
        parts = text.split(sep)
        pieces: list[str] = []
        current = ""
        for part in parts:
            candidate = current + sep + part if current else part
            if len(candidate) <= self._chunk_size:
                current = candidate
            else:
                if current:
                    pieces.append(current)
                if len(part) > self._chunk_size:
                    pieces.extend(self._split(part, rest))
                    current = ""
                else:
                    current = part
        if current:
            pieces.append(current)
        return pieces

    def _apply_overlap(self, pieces: list[str]) -> list[str]:
        """Prepends a trailing slice of the previous piece to each subsequent
        one, so context isn't lost at a chunk boundary.
        """
        if self._chunk_overlap <= 0 or len(pieces) <= 1:
            return pieces
        overlapped = [pieces[0]]
        for prev, piece in zip(pieces, pieces[1:], strict=False):
            carry = prev[-self._chunk_overlap :]
            overlapped.append(f"{carry}\n{piece}" if carry else piece)
        return overlapped

    def chunk(self, text: str, document_id: UUID, tenant_id: UUID) -> list[Chunk]:
        pieces = self._apply_overlap(self._split(text, _SEPARATORS))
        chunks: list[Chunk] = []
        for i, piece in enumerate(pieces):
            content = piece.strip()
            if not content:
                continue
            chunks.append(
                Chunk(
                    id=uuid4(),
                    document_id=document_id,
                    tenant_id=tenant_id,
                    chunk_index=i,
                    content=content,
                    char_count=len(content),
                    metadata={},
                )
            )
        return chunks
