"""
Phase 2 — order lookup/inventory tool definitions, backed by an
InternalHttpToolAdapter calling core-api's staff/customer order endpoints
under the invoking actor's own authenticated context (never a
service-wide credential — see domain/interfaces/tool_provider.py's
ActorContext and spec section 16). Not implemented in Phase 1 — see
registry.py's module docstring / ADR 0011, rule 30.
"""
