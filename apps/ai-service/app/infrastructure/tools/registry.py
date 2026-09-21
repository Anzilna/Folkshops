"""
Phase 2/3 (spec sections 15-16) — the registry exists now so the chat
pipeline's shape (RAG-only vs tool-using questions, spec section 17) doesn't
need to change when real tools land, but it registers zero tools in Phase 1.
No ProductSearchTool/OrderLookupTool/etc. exist yet because their only
caller would be this registry — building them now would be exactly the
"abstractions without callers" rule 30 prohibits. See ADR 0011.
"""

import logging

from app.domain.interfaces.tool_provider import ToolInvocation, ToolProvider, ToolResult

logger = logging.getLogger(__name__)


class ToolRegistry:
    def __init__(self, provider: ToolProvider | None = None):
        self._provider = provider
        self._tools: dict[str, dict] = {}

    def register(self, name: str, description: str, parameters: dict) -> None:
        self._tools[name] = {"name": name, "description": description, "parameters": parameters}

    def list_definitions(self) -> list[dict]:
        return list(self._tools.values())

    async def invoke(self, invocation: ToolInvocation) -> ToolResult:
        if invocation.tool_name not in self._tools:
            return ToolResult(tool_name=invocation.tool_name, output={}, error="Unknown tool")
        if self._provider is None:
            return ToolResult(tool_name=invocation.tool_name, output={}, error="No tool provider configured")
        return await self._provider.invoke(invocation)
