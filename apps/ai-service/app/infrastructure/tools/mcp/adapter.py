"""
Phase 2/3 — implements ToolProvider (domain/interfaces/tool_provider.py) on
top of mcp/client.py. This is the ONLY class that would import an MCP SDK;
ToolRegistry and every caller above it depend on ToolProvider, so replacing
MCP with a direct internal-HTTP adapter later means writing one new class
here, not touching application/chat code. Not implemented in Phase 1.
"""
