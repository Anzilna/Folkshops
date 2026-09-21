-- pgvector was not installed on the running Postgres image before this
-- service existed (postgres:16-alpine ships no `vector` extension at all —
-- confirmed live, see docs/decisions/0011). docker-compose.yml's postgres
-- image was switched to pgvector/pgvector:pg16, which is the same Postgres
-- 16 binaries with the extension pre-built.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE document_status AS ENUM ('uploaded', 'processing', 'indexed', 'failed');

CREATE TABLE documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    source text NOT NULL DEFAULT 'upload',
    status document_status NOT NULL DEFAULT 'uploaded',
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_tenant_id_idx ON documents (tenant_id);
CREATE INDEX documents_tenant_id_status_idx ON documents (tenant_id, status);

-- Embedding width is a schema-time constant (see Settings.embedding_dimensions
-- and ADR 0011) — 1536 matches OpenAI text-embedding-3-small, the Phase 1
-- default. Changing embedding model/provider to a different output width
-- requires a new migration + full re-embed, not a config toggle.
CREATE TABLE document_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    char_count integer NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(1536),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_chunks_document_id_idx ON document_chunks (document_id);
CREATE INDEX document_chunks_tenant_id_idx ON document_chunks (tenant_id);
-- IVFFlat needs rows to train lists against; fine to create empty in dev, a
-- real deployment re-runs `REINDEX`/rebuilds lists after the corpus is seeded.
CREATE INDEX document_chunks_embedding_idx ON document_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_tenant_id_actor_id_idx ON conversations (tenant_id, actor_id);

CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_id_idx ON messages (conversation_id);

-- RLS, same convention as core-api (docs/decisions/0003, bug #2's
-- empty-string GUC fix baked in from the start rather than needing a
-- follow-up migration).
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_chunks
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversations
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON documents, document_chunks, conversations, messages TO folkshops_ai;
