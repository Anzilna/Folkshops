-- The tool-calling agent (docs/decisions/0015): run/step audit trail,
-- confirmation-gated pending actions, and a per-conversation run lock.
-- Same RLS convention as 0001 (empty-string-GUC-safe policy, FORCE so the
-- table owner is subject to it too).

-- One agent run at a time per conversation. A Postgres lock rather than a
-- Redis one: Redis here fails open, and a lock that silently stops locking
-- when Redis is down would let two runs interleave on one conversation.
-- locked_until bounds how long a crashed run can hold it.
ALTER TABLE conversations
    ADD COLUMN active_run_id uuid,
    ADD COLUMN locked_until timestamptz;

-- Which run produced a message, and what the UI rendered alongside it
-- (citations, action cards, tool activity) so history can be re-shown.
ALTER TABLE messages
    ADD COLUMN run_id uuid,
    ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE agent_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    actor_id text NOT NULL,
    actor_type text NOT NULL,
    actor_role text,
    profile text NOT NULL,
    client_message_id uuid,
    status text NOT NULL DEFAULT 'running',
    models_used text[] NOT NULL DEFAULT '{}',
    iterations integer NOT NULL DEFAULT 0,
    tool_calls integer NOT NULL DEFAULT 0,
    input_tokens integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,
    cached_tokens integer NOT NULL DEFAULT 0,
    cost_usd_micros bigint NOT NULL DEFAULT 0,
    error_code text,
    -- The response returned to the client, so a resend with the same
    -- client_message_id gets it back instead of running again.
    response jsonb,
    trace_id text,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
);

CREATE UNIQUE INDEX agent_runs_client_message_idx ON agent_runs (conversation_id, client_message_id)
    WHERE client_message_id IS NOT NULL;
-- The rolling 24h per-tenant run budget counts on this.
CREATE INDEX agent_runs_tenant_started_idx ON agent_runs (tenant_id, started_at);

-- One row per LLM call and per tool call. Arguments are stored with the
-- tool's sensitive keys removed (ToolSpec.sensitive_args); results are
-- never stored, only their size and outcome.
CREATE TABLE agent_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    run_id uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    seq integer NOT NULL,
    kind text NOT NULL,                -- llm | tool
    tool_name text,
    args_redacted jsonb,
    args_hash text,
    policy_decision text,              -- allow | deny | confirm
    outcome text,                      -- ToolStatus, or the LLM stop reason
    error_code text,
    latency_ms integer,
    result_bytes integer,
    model text,
    input_tokens integer,
    output_tokens integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_steps_run_id_idx ON agent_steps (run_id);

-- A mutation the model proposed that a human must confirm. args are the
-- exact validated arguments that will run — the confirm endpoint executes
-- these, it never asks the model again. status moves pending -> executing
-- in one conditional UPDATE, so a double-clicked Confirm runs once.
CREATE TABLE agent_pending_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    actor_id text NOT NULL,
    actor_type text NOT NULL,
    run_id uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    tool_name text NOT NULL,
    args jsonb NOT NULL,
    args_hash text NOT NULL,
    card jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    outcome jsonb,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_pending_actions_conversation_idx ON agent_pending_actions (conversation_id);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_runs
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE agent_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_steps
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE agent_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_pending_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_pending_actions
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_runs, agent_steps, agent_pending_actions TO folkshops_ai;
