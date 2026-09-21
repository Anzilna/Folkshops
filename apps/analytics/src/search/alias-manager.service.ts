import type { Client } from "@elastic/elasticsearch";
import type { estypes } from "@elastic/elasticsearch";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ELASTICSEARCH_CLIENT } from "./elasticsearch-client.provider";
import { versionedIndexName, type IndexAlias } from "./indices";

/**
 * Owns the products_v1/products_v2 -> "products" alias indirection
 * (docs/decisions/0009's alias-based reindex strategy). Every other file
 * in this service references only the alias name — this is the one place
 * that knows a versioned index exists behind it.
 */
@Injectable()
export class AliasManagerService {
  private readonly logger = new Logger(AliasManagerService.name);

  constructor(@Inject(ELASTICSEARCH_CLIENT) private readonly client: Client) {}

  /** Creates the versioned index (if missing) with the given mapping, and
   * points the alias at it (if the alias doesn't exist yet). Safe to call
   * repeatedly — every step checks existence first. */
  async ensureAlias(alias: IndexAlias, mapping: { settings: estypes.IndicesIndexSettings; mappings: estypes.MappingTypeMapping }, version: number): Promise<void> {
    const indexName = versionedIndexName(alias, version);

    const indexExists = await this.client.indices.exists({ index: indexName });
    if (!indexExists) {
      await this.client.indices.create({ index: indexName, ...mapping });
      this.logger.log(`Created index ${indexName}`);
    }

    const aliasExists = await this.client.indices.existsAlias({ name: alias });
    if (!aliasExists) {
      await this.client.indices.putAlias({ index: indexName, name: alias });
      this.logger.log(`Alias ${alias} -> ${indexName}`);
    }
  }

  /**
   * Mapping-change reindex path — NOT used for initial population (that's
   * Debezium's own initial snapshot, consumed through the ordinary CDC
   * consumer path; see this service's own module comment). Creates
   * `{alias}_v{toVersion}`, copies every document from
   * `{alias}_v{fromVersion}` via ES's own _reindex API, then atomically
   * flips the alias (remove old + add new in one indices.updateAliases
   * call — no window where the alias resolves to nothing or to both).
   */
  async reindex(
    alias: IndexAlias,
    fromVersion: number,
    toVersion: number,
    mapping: { settings: estypes.IndicesIndexSettings; mappings: estypes.MappingTypeMapping },
  ): Promise<void> {
    const fromIndex = versionedIndexName(alias, fromVersion);
    const toIndex = versionedIndexName(alias, toVersion);

    await this.client.indices.create({ index: toIndex, ...mapping });
    await this.client.reindex({ source: { index: fromIndex }, dest: { index: toIndex } });

    await this.client.indices.updateAliases({
      actions: [{ remove: { index: fromIndex, alias } }, { add: { index: toIndex, alias } }],
    });

    this.logger.log(`Reindexed ${alias}: ${fromIndex} -> ${toIndex}, alias flipped atomically`);
  }
}
