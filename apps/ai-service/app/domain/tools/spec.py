"""
A tool's contract: what the model may call, with which arguments, and the
policy our code applies to it. The LLM only ever proposes a call — every
field here is enforced by application/agent (policy.py, tool_executor.py),
never by trusting the model to follow a description.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel


class Tier(str, Enum):
    READ_PUBLIC = "read_public"  # public catalog, the store's own knowledge base
    READ_SCOPED = "read_scoped"  # the actor's own data / staff-only data
    WRITE_LOW = "write_low"  # reversible, no money moves (the shopper's own cart)
    WRITE_CONFIRM = "write_confirm"  # business data — runs only after a human clicks Confirm


Profile = Literal["store_copilot", "shopper_assistant"]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    provider: Literal["local", "mcp"]
    profile: Profile
    tier: Tier
    timeout_s: float = 5.0
    # Read tools only: retries on a transport failure (timeout/connection).
    max_retries: int = 1
    max_calls_per_run: int = 4
    result_max_bytes: int = 6000
    # Argument keys never written to the audit log (e.g. a phone-number search).
    sensitive_args: frozenset[str] = field(default_factory=frozenset)

    @property
    def mutating(self) -> bool:
        return self.tier in (Tier.WRITE_LOW, Tier.WRITE_CONFIRM)

    @property
    def requires_confirmation(self) -> bool:
        return self.tier is Tier.WRITE_CONFIRM

    def llm_schema(self) -> dict:
        """The arguments' JSON Schema as the model sees it — see clean_schema()."""
        return clean_schema(self.args_model.model_json_schema())


def clean_schema(schema: Any) -> Any:
    """
    Pydantic's JSON Schema, simplified for an LLM: titles dropped, and
    `X | None` (anyOf [X, null]) collapsed to plain X — an optional field is
    simply one that isn't in `required`. Vendors' tool-schema support is a
    subset of JSON Schema (Gemini's especially), so the simplest valid
    schema is the safest one. Validation still happens on our side against
    the real Pydantic model, so nothing is lost.
    """
    if isinstance(schema, list):
        return [clean_schema(s) for s in schema]
    if not isinstance(schema, dict):
        return schema
    out: dict = {}
    for key, value in schema.items():
        if key == "title":
            continue
        if key == "default" and value is None:
            continue
        if key == "anyOf" and isinstance(value, list):
            non_null = [v for v in value if v != {"type": "null"}]
            if len(non_null) == 1:
                out.update(clean_schema(non_null[0]))
                continue
        out[key] = clean_schema(value)
    return out


def schema_compatible(ours: dict, served: dict) -> bool:
    """
    Do our argument model and the server's input schema agree on the
    argument names and which are required? Used to hide an MCP tool whose
    server-side contract has drifted from ours — fail closed rather than
    let the model call it with arguments one side doesn't understand.
    """
    return set(ours.get("properties", {})) == set(served.get("properties", {})) and set(
        ours.get("required", [])
    ) == set(served.get("required", []))
