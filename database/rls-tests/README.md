# database/rls-tests

Mandatory concurrent Row-Level Security isolation tests (rule: Tenant A must never see Tenant B data under a pooled connection). Required before any tenant-facing production functionality — see docs/decisions/0001-initial-stack.md.
