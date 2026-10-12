"""
Per-run accounting: iterations, tool calls, tokens, cost and wall-clock time,
checked before every LLM call so no run can loop or spend without bound.
"""

import time
from collections import Counter
from dataclasses import dataclass, field

from app.application.agent.profiles import RunLimits
from app.domain.interfaces.llm import LLMResponse


@dataclass(frozen=True)
class LlmPricing:
    """USD per million tokens (config). Zero on a free tier — tokens are still counted."""

    input_per_mtok: float = 0.0
    output_per_mtok: float = 0.0
    cached_per_mtok: float = 0.0

    def cost_micros(self, resp: LLMResponse) -> int:
        uncached = max(resp.prompt_tokens - resp.cached_tokens, 0)
        usd = (
            uncached * self.input_per_mtok
            + resp.cached_tokens * self.cached_per_mtok
            + resp.completion_tokens * self.output_per_mtok
        ) / 1_000_000
        return round(usd * 1_000_000)


@dataclass
class RunBudget:
    limits: RunLimits
    started_at: float = field(default_factory=time.monotonic)
    iterations: int = 0
    tool_calls: int = 0
    mutations: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    cost_usd_micros: int = 0
    calls_per_tool: Counter = field(default_factory=Counter)

    def record_llm(self, resp: LLMResponse, pricing: LlmPricing) -> None:
        self.iterations += 1
        self.input_tokens += resp.prompt_tokens
        self.output_tokens += resp.completion_tokens
        self.cached_tokens += resp.cached_tokens
        self.cost_usd_micros += pricing.cost_micros(resp)

    def elapsed_s(self) -> float:
        return time.monotonic() - self.started_at

    def remaining_s(self) -> float:
        return max(self.limits.wall_clock_s - self.elapsed_s(), 0.0)

    def exhausted(self) -> str | None:
        """Why the run must stop calling the model with tools, or None if it may continue."""
        if self.iterations >= self.limits.max_iterations:
            return "max_iterations"
        if self.input_tokens >= self.limits.max_input_tokens:
            return "token_budget"
        if self.elapsed_s() >= self.limits.wall_clock_s:
            return "wall_clock"
        return None
