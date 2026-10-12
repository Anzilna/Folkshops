"""
One orchestrator, two profiles — not two agents. Which profile runs is
decided only by the verified token's actor type (staff -> Store Copilot,
customer -> Shopper Assistant); nothing in a request can pick it.

Limits are deliberately small: every Folkshops task is a short chain of
lookups and at most one change. A run that needs more than this is far
more likely looping than doing useful work.
"""

from dataclasses import dataclass
from typing import Literal

from app.application.agent.prompts import SHOPPER_ASSISTANT_PROMPT, STORE_COPILOT_PROMPT
from app.domain.interfaces.tool_provider import ActorContext
from app.domain.tools.spec import Profile


@dataclass(frozen=True)
class RunLimits:
    max_iterations: int
    max_tool_calls: int
    max_mutations: int
    wall_clock_s: float
    max_input_tokens: int
    max_output_tokens: int
    # Earlier user/assistant messages replayed into each run.
    history_messages: int


@dataclass(frozen=True)
class AgentProfile:
    name: Profile
    model_tier: Literal["fast", "standard"]
    system_prompt: str
    limits: RunLimits


STORE_COPILOT = AgentProfile(
    name="store_copilot",
    model_tier="standard",
    system_prompt=STORE_COPILOT_PROMPT,
    limits=RunLimits(
        max_iterations=6,
        max_tool_calls=10,
        max_mutations=2,
        wall_clock_s=45.0,
        max_input_tokens=40_000,
        max_output_tokens=1024,
        history_messages=8,
    ),
)

SHOPPER_ASSISTANT = AgentProfile(
    name="shopper_assistant",
    model_tier="fast",
    system_prompt=SHOPPER_ASSISTANT_PROMPT,
    limits=RunLimits(
        max_iterations=4,
        max_tool_calls=6,
        max_mutations=3,
        wall_clock_s=25.0,
        max_input_tokens=20_000,
        max_output_tokens=600,
        history_messages=6,
    ),
)


def profile_for(actor: ActorContext) -> AgentProfile:
    return STORE_COPILOT if actor.actor_type == "staff" else SHOPPER_ASSISTANT
