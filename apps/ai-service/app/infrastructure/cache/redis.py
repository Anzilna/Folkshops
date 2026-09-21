"""
Redis for caching/rate-limiting/short-lived state only — never the source
of truth for documents/conversations (Postgres is). Fail-open: if Redis is
down, callers should treat a cache miss/rate-limit-check failure as "proceed
without it," matching CacheService/RedisThrottlerStorage's posture on the
Node side (see docs/decisions/0011).
"""

import json
import logging
from typing import Any

import redis.asyncio as redis

logger = logging.getLogger(__name__)


class CacheService:
    def __init__(self, url: str):
        self._client = redis.from_url(url, decode_responses=True)

    def _key(self, tenant_id: str, key: str) -> str:
        # Every key is tenant-prefixed — Redis has no RLS equivalent, so this
        # is the only isolation mechanism it gets (same convention as
        # core-api's CacheService, ADR 0008).
        return f"ai:{tenant_id}:{key}"

    async def get_json(self, tenant_id: str, key: str) -> Any | None:
        try:
            raw = await self._client.get(self._key(tenant_id, key))
            return json.loads(raw) if raw else None
        except Exception:
            logger.warning("cache get failed, proceeding without cache", exc_info=True)
            return None

    async def set_json(self, tenant_id: str, key: str, value: Any, ttl_seconds: int) -> None:
        try:
            await self._client.set(self._key(tenant_id, key), json.dumps(value), ex=ttl_seconds)
        except Exception:
            logger.warning("cache set failed, continuing without caching", exc_info=True)

    async def health_check(self) -> bool:
        try:
            return bool(await self._client.ping())
        except Exception:
            return False

    async def close(self) -> None:
        await self._client.aclose()


class RateLimiter:
    """
    Fixed-window counter via INCR+EXPIRE — good enough for this service's
    actual need (bounding chat/ingestion request rate per tenant), the same
    "start simple" posture as ModelRouter. Fails open: a Redis error means
    the request is allowed through rather than blocked, since a rate limiter
    that fails closed turns a Redis outage into a full outage.
    """

    def __init__(self, client: "redis.Redis"):
        self._client = client

    @classmethod
    def from_url(cls, url: str) -> "RateLimiter":
        return cls(redis.from_url(url, decode_responses=True))

    async def check(self, key: str, limit: int, window_seconds: int) -> bool:
        try:
            pipe = self._client.pipeline()
            pipe.incr(key)
            pipe.expire(key, window_seconds, nx=True)
            count, _ = await pipe.execute()
            return int(count) <= limit
        except Exception:
            logger.warning("rate limit check failed, failing open", exc_info=True)
            return True
