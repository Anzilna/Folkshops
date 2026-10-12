"""
In-process tools — the ones backed by this service's own data, where an MCP
hop to ourselves would only add latency and a failure mode. Today that's
knowledge_search over the existing RAG pipeline (retrieve -> rerank ->
ContextBuilder budget), unchanged.

Retrieved document text is untrusted: a merchant-uploaded PDF can contain
"ignore previous instructions". It goes to the model only as tool-result
data, labelled as such, and the system prompts (application/agent/
prompts.py) tell the model to treat it as information, never instructions.
Citations are collected server-side from what was actually retrieved and
never shown to the model.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from app.application.documents.ingest import DocumentService
from app.application.rag.pipeline import RagPipeline
from app.domain.interfaces.tool_provider import ActorContext, ToolOutcome, ToolStatus
from app.domain.tools.catalog import KnowledgeSearchArgs
from app.domain.tools.spec import clean_schema
from app.observability.logging import get_logger

logger = get_logger(__name__)

_RETRIEVAL_LIMIT = 6
# Below this cosine similarity a chunk is noise, not a source — citing it
# would invent a connection between the question and an unrelated document.
_MIN_SCORE = 0.2


class _LocalSession:
    def __init__(self, tenant_id: UUID, rag: RagPipeline, documents: DocumentService, include_platform: bool):
        self._tenant_id = tenant_id
        self._include_platform = include_platform
        self._rag = rag
        self._documents = documents

    def available(self) -> dict[str, dict]:
        return {"knowledge_search": clean_schema(KnowledgeSearchArgs.model_json_schema())}

    async def call(self, name: str, arguments: dict, timeout_s: float) -> ToolOutcome:
        if name != "knowledge_search":
            return ToolOutcome(
                tool_name=name, status=ToolStatus.FAILED, error_code="not_found", message="Unknown local tool"
            )
        try:
            context = await asyncio.wait_for(
                self._rag.run(
                    self._tenant_id, arguments["query"], retrieval_limit=_RETRIEVAL_LIMIT,
                    min_score=_MIN_SCORE,
                    include_platform=self._include_platform,
                ),
                timeout_s,
            )
        except TimeoutError:
            return ToolOutcome(
                tool_name=name, status=ToolStatus.FAILED, error_code="timeout", message="Search timed out"
            )
        except Exception:
            logger.warning("knowledge_search_failed", exc_info=True)
            return ToolOutcome(
                tool_name=name, status=ToolStatus.FAILED, error_code="unavailable", message="Knowledge base unavailable"
            )

        labels = await self._documents.labels(self._tenant_id, list({c.document_id for c in context.citations}))

        def label(document_id: UUID) -> str | None:
            found = labels.get(document_id)
            if found is None:
                return None
            filename, scope = found
            # The prefix is how the model (and the merchant, in the citation
            # chip) tells Folkshops' help content from the store's own files.
            return f"Folkshops help: {filename}" if scope == "platform" else filename

        citations = [c.model_copy(update={"filename": label(c.document_id)}) for c in context.citations]
        passages = [
            {"source": label(c.document_id) or "document", "text": text}
            for c, text in zip(context.citations, context.passages, strict=True)
        ]
        return ToolOutcome(
            tool_name=name,
            status=ToolStatus.SUCCEEDED,
            data={"passages": passages, "found": len(passages)},
            truncated=context.truncated,
            citations=citations,
        )


class LocalToolProvider:
    def __init__(self, rag: RagPipeline, documents: DocumentService):
        self._rag = rag
        self._documents = documents

    @asynccontextmanager
    async def session(self, actor: ActorContext) -> AsyncIterator[_LocalSession]:
        # Folkshops' own help content is for merchants only — a shopper's
        # assistant never searches it (decided here by who is asking, not by
        # anything the model or the request can influence).
        yield _LocalSession(UUID(actor.tenant_id), self._rag, self._documents, actor.actor_type == "staff")
