from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class DocumentStatus(str, Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    INDEXED = "indexed"
    FAILED = "failed"


class DocumentSource(str, Enum):
    UPLOAD = "upload"


class DocumentScope(str, Enum):
    TENANT = "tenant"
    PLATFORM = "platform"


# Folkshops' own help content lives in the same tables as store documents,
# under this reserved tenant id (migrations/0006, docs/decisions/0017). No
# real tenant can have it: tenants.id comes from gen_random_uuid().
PLATFORM_TENANT_ID = UUID("00000000-0000-0000-0000-000000000000")


def scope_for(tenant_id: UUID) -> DocumentScope:
    return DocumentScope.PLATFORM if tenant_id == PLATFORM_TENANT_ID else DocumentScope.TENANT


class Document(BaseModel):
    id: UUID
    tenant_id: UUID
    filename: str
    mime_type: str
    source: DocumentSource
    scope: DocumentScope = DocumentScope.TENANT
    status: DocumentStatus
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class DocumentPage(BaseModel):
    """camelCase totalPages on purpose — matches core-api's paginated list shape on the wire."""

    data: list[Document]
    total: int
    page: int
    limit: int
    totalPages: int
