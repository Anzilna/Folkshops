import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { AliasManagerService } from "./alias-manager.service";
import { INDEX_REGISTRY } from "./indices";

/**
 * Ensures every alias/index in INDEX_REGISTRY exists at boot. This is
 * NOT how Elasticsearch gets its initial data — Debezium's own
 * snapshot.mode=initial (docs/decisions/0009) emits the full existing
 * table contents as ordinary op:"r" CDC events through the exact same
 * consumer/upsert path as any later change, the moment the connector
 * first starts. This service only makes sure the index/alias EXISTS
 * before those events (or any business event) arrives — it never reads
 * Postgres itself.
 *
 * Wrapped in try/catch, never rethrown (CLAUDE.md bug #15's lesson
 * applied here too) — Elasticsearch being unreachable at boot must not
 * crash the whole app; the Kafka consumers would then just fail their own
 * index-write attempts individually (self-healing, see relay/consumer
 * failure-mode docs) rather than the process never starting at all.
 */
@Injectable()
export class SearchBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SearchBootstrapService.name);

  constructor(private readonly aliasManager: AliasManagerService) {}

  async onModuleInit(): Promise<void> {
    for (const [alias, { mapping, version }] of Object.entries(INDEX_REGISTRY)) {
      try {
        await this.aliasManager.ensureAlias(alias as keyof typeof INDEX_REGISTRY, mapping, version);
      } catch (err) {
        this.logger.warn(`Could not ensure index/alias "${alias}" at boot (Elasticsearch unreachable?): ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
