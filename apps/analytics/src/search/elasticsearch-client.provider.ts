import { Client } from "@elastic/elasticsearch";
import type { Provider } from "@nestjs/common";

/**
 * Same swap-seam DI-token pattern as core-api's PAYMENT_GATEWAY
 * (payment-provider.interface.ts) — one Symbol, bound via useFactory,
 * exported by SearchModule so kafka-consumers/analytics-api can inject it.
 *
 * The Client() constructor here does not perform any network I/O (the ES
 * client lazily connects per-request, unlike a Kafka producer's explicit
 * .connect()) — so, unlike apps/workers' Kafka producer, there's no
 * separate "ensure connected" step needed to satisfy CLAUDE.md bug #15's
 * lesson. What DOES need that lesson applied is SearchBootstrapService's
 * OnModuleInit (see search.module.ts) — ensuring indices/aliases exist is
 * a real network call, and must not crash the whole app at boot if ES
 * happens to be down that moment.
 */
export const ELASTICSEARCH_CLIENT = Symbol("ELASTICSEARCH_CLIENT");

export const elasticsearchClientProvider: Provider = {
  provide: ELASTICSEARCH_CLIENT,
  useFactory: () =>
    new Client({
      node: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
    }),
};
