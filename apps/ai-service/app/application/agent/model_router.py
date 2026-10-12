"""
Which model a call uses. Deliberately rule-based, not an extra "classifier"
LLM call (which would add latency and quota use to every message):

- the profile picks the tier (shopper -> fast, copilot -> standard);
- after the model produced invalid tool arguments or repeated itself, the
  next iteration escalates to the standard model;
- on a retryable vendor error (rate limit, timeout, 5xx) the caller retries
  once on the fallback model. An LLM call has no side effects, so this is
  always safe.

Model ids come from config (infrastructure/llm/router.py's ModelSet).
"""

from typing import Literal


class ModelRouter:
    def __init__(self, *, fast: str, standard: str, fallback: str | None):
        self._fast = fast
        self._standard = standard
        self._fallback = fallback

    def primary(self, tier: Literal["fast", "standard"], *, escalate: bool = False) -> str:
        if escalate or tier == "standard":
            return self._standard
        return self._fast

    def fallback_for(self, model: str) -> str | None:
        if self._fallback and self._fallback != model:
            return self._fallback
        # No separate fallback configured: the other tier is the next best.
        other = self._fast if model == self._standard else self._standard
        return other if other != model else None
