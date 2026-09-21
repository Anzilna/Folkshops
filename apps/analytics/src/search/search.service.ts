import type { Client } from "@elastic/elasticsearch";
import { Inject, Injectable } from "@nestjs/common";
import { ELASTICSEARCH_CLIENT } from "./elasticsearch-client.provider";
import type { IndexAlias } from "./indices";

@Injectable()
export class SearchService {
  constructor(@Inject(ELASTICSEARCH_CLIENT) readonly client: Client) {}

  /** Full-document upsert at a deterministic id — the entire idempotency
   * mechanism for CDC/business-event indexing (docs/decisions/0009). Safe
   * to call twice with the same id/body: the second call just rewrites
   * the same document, no duplicate, no dedup table needed. */
  async index(alias: IndexAlias, id: string, body: Record<string, unknown>): Promise<void> {
    await this.client.index({ index: alias, id, document: body });
  }

  /** Idempotent delete — a redelivered delete for an already-deleted doc
   * 404s, which is treated as success, not an error. */
  async delete(alias: IndexAlias, id: string): Promise<void> {
    try {
      await this.client.delete({ index: alias, id });
    } catch (err) {
      const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
      if (status !== 404) throw err;
    }
  }

  async getDocument<T>(alias: IndexAlias, id: string): Promise<T | null> {
    try {
      const res = await this.client.get<T>({ index: alias, id });
      return res._source ?? null;
    } catch (err) {
      const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
      if (status === 404) return null;
      throw err;
    }
  }
}
