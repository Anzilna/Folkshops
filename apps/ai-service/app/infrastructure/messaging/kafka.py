"""
document.created / document.indexed / document.failed — disabled by default
(KAFKA_EVENTS_ENABLED=false). See docs/decisions/0011 for why this exists
fully implemented but unwired: no consumer for these currently exists
anywhere in Folkshops, so turning it on is a config change away, not a code
change, the moment one does.

Deliberately NOT the outbox pattern: these events aren't written inside the
same Postgres transaction as a state change (this service uses arq jobs, not
an outbox table, for its own reliability — see ADR 0011's "Document
ingestion queue" section). A dropped publish here just means a future
consumer doesn't get told promptly; it never risks losing the underlying
state change itself, which Postgres already holds durably regardless.
"""

import json
import logging
from typing import Protocol
from uuid import UUID

logger = logging.getLogger(__name__)


class EventPublisher(Protocol):
    async def publish_document_event(self, event_type: str, tenant_id: UUID, document_id: UUID) -> None: ...


class NullEventPublisher:
    """Default when KAFKA_EVENTS_ENABLED=false — a real no-op, not a silent failure path."""

    async def publish_document_event(self, event_type: str, tenant_id: UUID, document_id: UUID) -> None:
        logger.debug("kafka events disabled, skipping publish of %s", event_type)


class KafkaEventPublisher:
    def __init__(self, brokers: str):
        self._brokers = brokers
        self._producer = None

    async def _get_producer(self):
        if self._producer is None:
            from aiokafka import AIOKafkaProducer

            self._producer = AIOKafkaProducer(bootstrap_servers=self._brokers)
            await self._producer.start()
        return self._producer

    async def publish_document_event(self, event_type: str, tenant_id: UUID, document_id: UUID) -> None:
        try:
            producer = await self._get_producer()
            envelope = {
                "eventType": event_type,
                "aggregateType": "document",
                "aggregateId": str(document_id),
                "tenantId": str(tenant_id),
            }
            await producer.send_and_wait(
                "folkshops.events.ai-document", json.dumps(envelope).encode("utf-8")
            )
        except Exception:
            # Best-effort — a failed publish never fails the ingestion job
            # itself (see module docstring: this isn't the outbox).
            logger.warning("failed to publish document event %s", event_type, exc_info=True)

    async def close(self) -> None:
        if self._producer is not None:
            await self._producer.stop()
