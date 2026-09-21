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


class Document(BaseModel):
    id: UUID
    tenant_id: UUID
    filename: str
    mime_type: str
    source: DocumentSource
    status: DocumentStatus
    error: str | None = None
    created_at: datetime
    updated_at: datetime
