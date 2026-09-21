from app.config import Settings
from app.domain.errors import VectorStoreError
from app.domain.interfaces.vector_store import VectorStore
from app.infrastructure.persistence.postgres import Db
from app.infrastructure.vector_store.pgvector import PgVectorStore
from app.infrastructure.vector_store.qdrant import QdrantVectorStore


def build_vector_store(settings: Settings, db: Db) -> VectorStore:
    if settings.vector_store == "pgvector":
        return PgVectorStore(db)
    if settings.vector_store == "qdrant":
        return QdrantVectorStore(url="")  # not implemented — see qdrant.py
    raise VectorStoreError(f"Unknown VECTOR_STORE: {settings.vector_store}")
