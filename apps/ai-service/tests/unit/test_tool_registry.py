import pytest

from app.domain.interfaces.tool_provider import ActorContext, ToolInvocation, ToolResult
from app.infrastructure.tools.registry import ToolRegistry


def _invocation(tool_name: str) -> ToolInvocation:
    return ToolInvocation(
        tool_name=tool_name,
        arguments={},
        actor=ActorContext(tenant_id="t1", actor_id="u1", actor_type="staff"),
    )


@pytest.mark.asyncio
async def test_unknown_tool_returns_structured_error():
    registry = ToolRegistry()
    result = await registry.invoke(_invocation("does_not_exist"))
    assert result.error == "Unknown tool"


@pytest.mark.asyncio
async def test_registered_tool_without_provider_returns_structured_error():
    registry = ToolRegistry(provider=None)
    registry.register("ping", "test tool", {})
    result = await registry.invoke(_invocation("ping"))
    assert result.error == "No tool provider configured"


@pytest.mark.asyncio
async def test_registered_tool_with_provider_delegates_to_it():
    class StubProvider:
        async def invoke(self, invocation: ToolInvocation) -> ToolResult:
            return ToolResult(tool_name=invocation.tool_name, output={"ok": True})

    registry = ToolRegistry(provider=StubProvider())
    registry.register("ping", "test tool", {})
    result = await registry.invoke(_invocation("ping"))
    assert result.output == {"ok": True}
    assert result.error is None


def test_list_definitions_reflects_registered_tools():
    registry = ToolRegistry()
    registry.register("a", "desc", {"type": "object"})
    defs = registry.list_definitions()
    assert len(defs) == 1
    assert defs[0]["name"] == "a"
