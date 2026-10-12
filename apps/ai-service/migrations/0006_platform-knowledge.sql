-- Platform-owned knowledge: Folkshops' own help content, readable by every
-- store's Store Copilot (docs/decisions/0017). Same tables, same embedding
-- column, same pipeline — a platform row is just a document whose tenant_id
-- is the reserved nil UUID.
--
--   * tenant_id stays NOT NULL, so tenant_isolation (0001) and every index
--     keep working unchanged. A platform write runs with app.tenant_id set
--     to the nil UUID, which only ai-service's platform-admin routes do —
--     no tenant's own context can ever equal it.
--   * `scope` is derived from tenant_id (the CHECK pins them together), so
--     the two can never disagree.
--   * The new policy is READ-ONLY (FOR SELECT): a tenant can see platform
--     rows but cannot insert, update or delete one. Permissive policies OR
--     together, so tenant_isolation still gives each tenant its own rows.

ALTER TABLE documents ADD COLUMN scope text NOT NULL DEFAULT 'tenant';
ALTER TABLE documents ADD CONSTRAINT documents_scope_check CHECK (
    (scope = 'platform' AND tenant_id = '00000000-0000-0000-0000-000000000000')
    OR (scope = 'tenant' AND tenant_id <> '00000000-0000-0000-0000-000000000000')
);

ALTER TABLE document_chunks ADD COLUMN scope text NOT NULL DEFAULT 'tenant';
ALTER TABLE document_chunks ADD CONSTRAINT document_chunks_scope_check CHECK (
    (scope = 'platform' AND tenant_id = '00000000-0000-0000-0000-000000000000')
    OR (scope = 'tenant' AND tenant_id <> '00000000-0000-0000-0000-000000000000')
);

CREATE POLICY platform_read ON documents FOR SELECT USING (scope = 'platform');
CREATE POLICY platform_read ON document_chunks FOR SELECT USING (scope = 'platform');
