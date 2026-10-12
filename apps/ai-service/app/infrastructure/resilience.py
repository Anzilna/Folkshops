"""
A minimal in-process circuit breaker. After `failure_threshold` consecutive
failures within `window_s`, calls are refused for `cooldown_s`; then one
trial call is let through (half-open) and its result closes or re-opens the
circuit. Per process, deliberately — each ai-service instance protects
itself from hammering a dependency that's down; no shared state needed.
"""

import time


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, window_s: float = 30.0, cooldown_s: float = 15.0):
        self._threshold = failure_threshold
        self._window_s = window_s
        self._cooldown_s = cooldown_s
        self._failures: list[float] = []
        self._opened_at: float | None = None

    @property
    def is_open(self) -> bool:
        return self._opened_at is not None and time.monotonic() - self._opened_at < self._cooldown_s

    def allow(self) -> bool:
        # Past the cooldown, a call is allowed through as the half-open trial.
        return not self.is_open

    def record_success(self) -> None:
        self._failures.clear()
        self._opened_at = None

    def record_failure(self) -> None:
        now = time.monotonic()
        self._failures = [t for t in self._failures if now - t < self._window_s] + [now]
        if len(self._failures) >= self._threshold or self._opened_at is not None:
            # A failed half-open trial re-opens immediately.
            self._opened_at = now
