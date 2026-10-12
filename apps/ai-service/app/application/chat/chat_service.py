"""
POST /chat's use case (spec section 17): resolve/create a conversation ->
run RAG -> build a prompt from the retrieved context -> call the LLM ->
persist both turns -> return a structured response with citations.

Tool-decision/tool-execution (spec section 17's full flow) is Phase 2 — see
ToolRegistry's module docstring. This is deliberately the RAG-only half of
that flow, wired so a tool-decision step can be inserted between
`_build_context` and `_call_llm` later without changing this class's public
shape.
"""

import time
from uuid import UUID, uuid4

from sqlalchemy import select

from app.application.documents.ingest import DocumentService
from app.application.rag.pipeline import RagPipeline
from app.domain.interfaces.llm import LLMMessage, LLMProvider, LLMRequest
from app.domain.models.chat import ChatResponse, Role
from app.infrastructure.persistence.models import ConversationRow, MessageRow
from app.infrastructure.persistence.postgres import Db
from app.observability.metrics import Metrics

_SYSTEM_PROMPT_TEMPLATE = (
    "You are a helpful assistant for an online store. Answer the user's question using ONLY the "
    "context below. If the context doesn't contain the answer, say you don't know — never invent "
    "information.\n\nContext:\n{context}"
)


class ChatService:
    def __init__(
        self,
        db: Db,
        rag_pipeline: RagPipeline,
        llm: LLMProvider,
        chat_model: str,
        metrics: Metrics,
        documents: DocumentService,
    ):
        self._db = db
        self._documents = documents
        self._rag_pipeline = rag_pipeline
        self._llm = llm
        self._chat_model = chat_model
        self._metrics = metrics

    async def _get_or_create_conversation(self, tenant_id: UUID, actor_id: str, conversation_id: UUID | None) -> UUID:
        async with self._db.tenant_context(str(tenant_id)) as session:
            if conversation_id is not None:
                existing = await session.scalar(
                    select(ConversationRow.id).where(
                        ConversationRow.id == conversation_id, ConversationRow.actor_id == actor_id
                    )
                )
                if existing is not None:
                    return existing
            conversation = ConversationRow(id=uuid4(), tenant_id=tenant_id, actor_id=actor_id)
            session.add(conversation)
            return conversation.id

    async def _store_message(self, tenant_id: UUID, conversation_id: UUID, role: Role, content: str) -> None:
        async with self._db.tenant_context(str(tenant_id)) as session:
            session.add(
                MessageRow(
                    id=uuid4(),
                    conversation_id=conversation_id,
                    tenant_id=tenant_id,
                    role=role.value,
                    content=content,
                )
            )

    async def send_message(
        self, tenant_id: UUID, actor_id: str, conversation_id: UUID | None, message: str
    ) -> ChatResponse:
        conversation_id = await self._get_or_create_conversation(tenant_id, actor_id, conversation_id)
        await self._store_message(tenant_id, conversation_id, Role.USER, message)

        context = await self._rag_pipeline.run(tenant_id, message)
        system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(context=context.text or "(no relevant context found)")

        start = time.monotonic()
        response = await self._llm.generate(
            LLMRequest(
                model=self._chat_model,
                messages=[LLMMessage(role=Role.USER, content=message)],
                system_prompt=system_prompt,
            )
        )
        self._metrics.llm_latency.record((time.monotonic() - start) * 1000)
        self._metrics.llm_tokens.add(response.prompt_tokens, {"kind": "prompt"})
        self._metrics.llm_tokens.add(response.completion_tokens, {"kind": "completion"})

        await self._store_message(tenant_id, conversation_id, Role.ASSISTANT, response.content)

        # Citations must correspond to chunks actually retrieved — never
        # invented (spec section 19). They come straight from
        # ContextBuilder's output, not parsed out of the model's answer.
        filenames = await self._documents.filenames(tenant_id, list({c.document_id for c in context.citations}))
        citations = [c.model_copy(update={"filename": filenames.get(c.document_id)}) for c in context.citations]
        return ChatResponse(conversation_id=conversation_id, answer=response.content, citations=citations)
