"""
Section 23's metric list (API/LLM/embedding/vector-search/reranking/tool
latency, token usage, errors, cache hit/miss, retrieval count/scores) as
OpenTelemetry counters/histograms. A single module-level Metrics instance is
used throughout — created once at startup (main.py), passed via DI like
everything else, never a bare global import inside application code.
"""

from opentelemetry import metrics


class Metrics:
    def __init__(self, service_name: str):
        meter = metrics.get_meter(service_name)
        self.request_latency = meter.create_histogram("http.request.duration", unit="ms")
        self.llm_latency = meter.create_histogram("llm.request.duration", unit="ms")
        self.embedding_latency = meter.create_histogram("embedding.request.duration", unit="ms")
        self.vector_search_latency = meter.create_histogram("vector_store.search.duration", unit="ms")
        self.rerank_latency = meter.create_histogram("reranker.duration", unit="ms")
        self.tool_latency = meter.create_histogram("tool.invocation.duration", unit="ms")
        self.llm_tokens = meter.create_counter("llm.tokens")
        self.errors = meter.create_counter("errors")
        self.cache_hits = meter.create_counter("cache.hits")
        self.cache_misses = meter.create_counter("cache.misses")
        self.retrieval_count = meter.create_histogram("retrieval.result_count")
        self.retrieval_score = meter.create_histogram("retrieval.score")
        # Agent (application/agent/). Cost per run = agent.cost_usd_micros /
        # agent.runs, sliceable by profile; tokens by model via llm.tokens.
        self.agent_runs = meter.create_counter("agent.runs")
        self.agent_iterations = meter.create_histogram("agent.iterations")
        self.agent_tool_calls = meter.create_counter("agent.tool_calls")
        self.agent_cost_usd_micros = meter.create_counter("agent.cost_usd_micros")
