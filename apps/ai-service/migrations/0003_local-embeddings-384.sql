-- Switch the embedding column from vector(1536) (OpenAI text-embedding-3-small)
-- to vector(384) for the in-process BAAI/bge-small-en-v1.5 model
-- (EMBEDDING_PROVIDER=local, see infrastructure/embeddings/local.py and
-- docs/decisions/0011's local-embeddings addendum).
--
-- Vectors from one model are meaningless to another, so every existing
-- embedding is cleared rather than converted. The chunk text is kept:
-- scripts/reembed_all.py queues the existing reembed_document job for each
-- document, which re-embeds from document_chunks.content with no re-upload.
-- Until that runs, search skips chunks with a NULL embedding.

DROP INDEX IF EXISTS document_chunks_embedding_idx;

UPDATE document_chunks SET embedding = NULL WHERE embedding IS NOT NULL;

ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(384);

-- HNSW instead of the previous IVFFlat: IVFFlat learns its list centroids
-- from the rows present when the index is built, and 0001 built it on an
-- empty table, so its lists never reflected real data and recall suffered.
-- HNSW has no training step and keeps good recall as rows are added
-- (pgvector >= 0.5; the compose image ships 0.8).
CREATE INDEX document_chunks_embedding_idx ON document_chunks
    USING hnsw (embedding vector_cosine_ops);
