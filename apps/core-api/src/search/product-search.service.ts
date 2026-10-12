import { Client } from "@elastic/elasticsearch";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Same alias apps/analytics' CDC consumer writes to (its search/indices.ts) — Debezium keeps it in step with the products table. */
const PRODUCTS_ALIAS = "products";
/** Relevance past a few hundred results is noise for a search box; also bounds the `id IN (...)` list handed back to Postgres. */
const MAX_CANDIDATES = 500;
/** A search box must never hang on a sick cluster — past this, fall back to Postgres. */
const REQUEST_TIMEOUT_MS = 1500;

export interface ProductSearchFilters {
  status?: string;
  categoryId?: string;
  isActive?: boolean;
}

/**
 * Full-text product search (relevance ranking, typo tolerance, description
 * matching) against the Elasticsearch read model apps/analytics maintains
 * from Debezium CDC. See docs/decisions/0014.
 *
 * Elasticsearch only PROPOSES candidate ids, in relevance order —
 * ProductsService still loads and filters the real rows from Postgres
 * (RLS, deletedAt, status...). So the index lagging a few seconds behind
 * can make a brand-new product briefly unsearchable, but can never surface
 * a deleted, inactive, or other tenant's product.
 *
 * Fails open, never throws: unset ELASTICSEARCH_URL, cluster down, or a
 * timeout all return null and the caller falls back to its old Postgres
 * ILIKE search. Client is built lazily (bug #15 — never validate optional
 * external config in a constructor).
 */
@Injectable()
export class ProductSearchService {
  private readonly logger = new Logger(ProductSearchService.name);
  private client: Client | null | undefined;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Client | null {
    if (this.client === undefined) {
      const node = this.config.get<string>("ELASTICSEARCH_URL");
      this.client = node ? new Client({ node, requestTimeout: REQUEST_TIMEOUT_MS, maxRetries: 0 }) : null;
    }
    return this.client;
  }

  /** Matching product ids, best match first — or null if search is unavailable. */
  async searchIds(tenantId: string, text: string, filters: ProductSearchFilters): Promise<string[] | null> {
    const client = this.getClient();
    if (!client) return null;

    const filter: object[] = [{ term: { tenantId } }];
    if (filters.status) filter.push({ term: { status: filters.status } });
    if (filters.categoryId) filter.push({ term: { categoryId: filters.categoryId } });
    if (filters.isActive !== undefined) filter.push({ term: { isActive: filters.isActive } });

    try {
      const res = await client.search<{ productId: string }>({
        index: PRODUCTS_ALIAS,
        size: MAX_CANDIDATES,
        _source: ["productId"],
        query: {
          bool: {
            filter,
            must_not: [{ exists: { field: "deletedAt" } }],
            should: [
              // Whole words, typo-tolerant ("shrit" -> shirt); a hit in the
              // name outweighs one in the description.
              { multi_match: { query: text, fields: ["name^3", "description"], fuzziness: "AUTO" } },
              // Prefix of the name, so typing "lin" already finds "Linen
              // ..." — what the old ILIKE gave for free, kept so search
              // doesn't feel worse mid-word.
              { match_phrase_prefix: { name: { query: text, boost: 2 } } },
            ],
            minimum_should_match: 1,
          },
        },
      });
      return res.hits.hits.map((hit) => hit._source!.productId);
    } catch (err) {
      this.logger.warn(`Elasticsearch product search failed, falling back to Postgres: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
