"""
POST /documents accepts an upload, creates the metadata row, and returns
immediately (202) — parsing/chunking/embedding never runs inside this
request (spec section 4). The actual bytes travel to the worker through the
arq job payload (Redis-backed), not a second storage system — an accepted,
documented Phase 1 simplification for the sizes MAX_UPLOAD_BYTES allows; see
docs/decisions/0011.
"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, status

from app.api.dependencies import get_document_service, require_ai_access
from app.application.documents.ingest import DocumentService
from app.application.documents.parse import SUPPORTED_MIME_TYPES
from app.config import Settings, get_settings
from app.domain.errors import DocumentNotFound
from app.domain.interfaces.tool_provider import ActorContext
from app.domain.models.document import Document, DocumentPage, DocumentStatus

# Every route: staff only, and only for a plan that includes AI (see
# require_ai_access). A store that downgrades keeps its documents but can't
# reach them until it upgrades again.
router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=Document)
async def upload_document(
    request: Request,
    file: UploadFile,
    actor: ActorContext = Depends(require_ai_access),
    documents: DocumentService = Depends(get_document_service),
    settings: Settings = Depends(get_settings),
) -> Document:
    if file.content_type not in SUPPORTED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported mime type: {file.content_type}",
        )

    content = await file.read()
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.max_upload_bytes} bytes",
        )

    document = await documents.create(UUID(actor.tenant_id), file.filename or "untitled", file.content_type)

    arq_pool = request.app.state.arq_pool
    await arq_pool.enqueue_job("ingest_document", str(actor.tenant_id), str(document.id), content, file.content_type)

    return document


@router.get("/{document_id}", response_model=Document)
async def get_document(
    document_id: UUID,
    actor: ActorContext = Depends(require_ai_access),
    documents: DocumentService = Depends(get_document_service),
) -> Document:
    try:
        return await documents.get(UUID(actor.tenant_id), document_id)
    except DocumentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("", response_model=DocumentPage)
async def list_documents(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=200),
    status_filter: DocumentStatus | None = Query(None, alias="status"),
    sort_by: Literal["createdAt", "filename", "status"] = Query("createdAt", alias="sortBy"),
    sort_dir: Literal["asc", "desc"] = Query("desc", alias="sortDir"),
    actor: ActorContext = Depends(require_ai_access),
    documents: DocumentService = Depends(get_document_service),
) -> DocumentPage:
    return await documents.list_for_tenant(
        UUID(actor.tenant_id),
        page=page,
        limit=limit,
        search=search or None,
        status=status_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: UUID,
    actor: ActorContext = Depends(require_ai_access),
    documents: DocumentService = Depends(get_document_service),
) -> Response:
    try:
        await documents.delete(UUID(actor.tenant_id), document_id)
    except DocumentNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
