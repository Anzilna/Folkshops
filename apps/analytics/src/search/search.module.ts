import { Module } from "@nestjs/common";
import { AliasManagerService } from "./alias-manager.service";
import { elasticsearchClientProvider, ELASTICSEARCH_CLIENT } from "./elasticsearch-client.provider";
import { SearchBootstrapService } from "./search-bootstrap.service";
import { SearchService } from "./search.service";

@Module({
  providers: [elasticsearchClientProvider, AliasManagerService, SearchBootstrapService, SearchService],
  // ELASTICSEARCH_CLIENT itself is exported (not just the services wrapping
  // it) so a future consumer needing a raw query (e.g. analytics-api's
  // aggregations) can inject it directly — same "export the token, not
  // just the service" lesson as core-api's PAYMENT_GATEWAY (CLAUDE.md's
  // sibling to bug #3/#15).
  exports: [ELASTICSEARCH_CLIENT, AliasManagerService, SearchService],
})
export class SearchModule {}
