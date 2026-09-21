"""
OpenTelemetry tracing. OTEL_EXPORTER_OTLP_ENDPOINT unset means no exporter
is configured at all (no collector required to boot this service in dev —
fail-open, same posture as CacheService on the Node side) rather than
defaulting to a console spam exporter or failing to start.
"""

import logging

from opentelemetry import trace
from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = logging.getLogger(__name__)


def configure_tracing(service_name: str, otlp_endpoint: str | None) -> None:
    resource = Resource.create({SERVICE_NAME: service_name})
    provider = TracerProvider(resource=resource)

    if otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint)))
        logger.info("tracing exporting to %s", otlp_endpoint)
    else:
        logger.info("OTEL_EXPORTER_OTLP_ENDPOINT unset — tracing spans are created but not exported")

    trace.set_tracer_provider(provider)
    AsyncPGInstrumentor().instrument()


def instrument_app(app) -> None:
    FastAPIInstrumentor.instrument_app(app)


def get_tracer(name: str):
    return trace.get_tracer(name)
