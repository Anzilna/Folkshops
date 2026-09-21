import type { Client } from "@elastic/elasticsearch";
import { Inject, Injectable } from "@nestjs/common";
import { ELASTICSEARCH_CLIENT } from "../search/elasticsearch-client.provider";
import type { DateRangeDto, SalesOverTimeDto } from "./dto/date-range.dto";
import type { PaginationQueryDto } from "./dto/pagination-query.dto";

const ORDER_ANALYTICS_INDEX = "order_analytics";

/**
 * Every query here filters on `term: { tenantId }` built from the
 * verified JWT (@CurrentTenant(), see analytics.controller.ts) — never a
 * value the caller supplied. Elasticsearch has no RLS-equivalent, so this
 * filter is the entire tenant-isolation enforcement for this data plane;
 * see docs/decisions/0009.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(ELASTICSEARCH_CLIENT) private readonly client: Client) {}

  private dateRangeFilter(range: DateRangeDto) {
    if (!range.from && !range.to) return [];
    return [{ range: { occurredAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } }];
  }

  async revenue(tenantId: string, range: DateRangeDto) {
    const result = await this.client.search({
      index: ORDER_ANALYTICS_INDEX,
      size: 0,
      query: {
        bool: {
          filter: [{ term: { tenantId } }, { term: { status: "paid" } }, ...this.dateRangeFilter(range)],
        },
      },
      aggs: {
        totalRevenueCents: { sum: { field: "subtotalCents" } },
        orderCount: { value_count: { field: "orderId" } },
        unitsSold: { nested: { path: "items" }, aggs: { total: { sum: { field: "items.quantity" } } } },
      },
    });

    const aggs = result.aggregations as {
      totalRevenueCents: { value: number };
      orderCount: { value: number };
      unitsSold: { total: { value: number } };
    };
    return {
      totalRevenueCents: aggs.totalRevenueCents.value ?? 0,
      orderCount: aggs.orderCount.value ?? 0,
      unitsSold: aggs.unitsSold.total.value ?? 0,
    };
  }

  async orders(tenantId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.client.search({
      index: ORDER_ANALYTICS_INDEX,
      from: (page - 1) * limit,
      size: limit,
      sort: [{ occurredAt: { order: "desc" } }],
      query: { bool: { filter: [{ term: { tenantId } }] } },
      track_total_hits: true,
    });

    const total = typeof result.hits.total === "number" ? result.hits.total : (result.hits.total?.value ?? 0);
    return {
      data: result.hits.hits.map((hit) => hit._source),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async topProducts(tenantId: string, range: DateRangeDto, limit = 10) {
    const result = await this.client.search({
      index: ORDER_ANALYTICS_INDEX,
      size: 0,
      query: {
        bool: { filter: [{ term: { tenantId } }, { term: { status: "paid" } }, ...this.dateRangeFilter(range)] },
      },
      aggs: {
        byProduct: {
          nested: { path: "items" },
          aggs: {
            products: {
              terms: { field: "items.productId", size: limit, order: { revenueCents: "desc" } },
              aggs: {
                revenueCents: { sum: { script: { source: "doc['items.priceCents'].value * doc['items.quantity'].value" } } },
                unitsSold: { sum: { field: "items.quantity" } },
                productName: { terms: { field: "items.productName.keyword", size: 1 } },
              },
            },
          },
        },
      },
    });

    const buckets = (
      result.aggregations as {
        byProduct: {
          products: {
            buckets: {
              key: string;
              doc_count: number;
              revenueCents: { value: number };
              unitsSold: { value: number };
              productName: { buckets: { key: string }[] };
            }[];
          };
        };
      }
    ).byProduct.products.buckets;

    return buckets.map((bucket) => ({
      productId: bucket.key,
      productName: bucket.productName.buckets[0]?.key ?? bucket.key,
      revenueCents: bucket.revenueCents.value,
      unitsSold: bucket.unitsSold.value,
      orderLineCount: bucket.doc_count,
    }));
  }

  async salesOverTime(tenantId: string, query: SalesOverTimeDto) {
    const CALENDAR_INTERVALS = { day: "1d", week: "1w", month: "1M" } as const;
    const calendarInterval = CALENDAR_INTERVALS[query.interval ?? "day"];

    const result = await this.client.search({
      index: ORDER_ANALYTICS_INDEX,
      size: 0,
      query: {
        bool: { filter: [{ term: { tenantId } }, { term: { status: "paid" } }, ...this.dateRangeFilter(query)] },
      },
      aggs: {
        overTime: {
          date_histogram: {
            field: "occurredAt",
            calendar_interval: calendarInterval,
            // Zero-fills days with no paid orders across the FULL
            // requested range (ES's date_histogram otherwise only spans
            // first-doc to last-doc) — needed so two periods of equal
            // length line up bucket-for-bucket when the frontend overlays
            // "this period" against "previous period" on one chart.
            ...(query.from && query.to ? { extended_bounds: { min: query.from, max: query.to } } : {}),
          },
          aggs: {
            revenueCents: { sum: { field: "subtotalCents" } },
            unitsSold: { nested: { path: "items" }, aggs: { total: { sum: { field: "items.quantity" } } } },
          },
        },
      },
    });

    const buckets = (
      result.aggregations as {
        overTime: {
          buckets: { key_as_string: string; doc_count: number; revenueCents: { value: number }; unitsSold: { total: { value: number } } }[];
        };
      }
    ).overTime.buckets;

    return buckets.map((bucket) => ({
      date: bucket.key_as_string,
      orderCount: bucket.doc_count,
      revenueCents: bucket.revenueCents.value,
      unitsSold: bucket.unitsSold.total.value ?? 0,
    }));
  }

  // Same underlying aggregation as topProducts, richer per-product shape —
  // kept as a distinct method (not a query-param variant) since the two
  // are named as separate endpoints in the spec.
  async productPerformance(tenantId: string, query: PaginationQueryDto) {
    return this.topProducts(tenantId, {}, query.limit ?? 20);
  }
}
