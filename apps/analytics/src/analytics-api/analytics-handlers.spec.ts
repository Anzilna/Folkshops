import { GetRevenueHandler } from "./queries/get-revenue.handler";
import { GetRevenueQuery } from "./queries/get-revenue.query";
import { GetTopProductsHandler } from "./queries/get-top-products.handler";
import { GetTopProductsQuery } from "./queries/get-top-products.query";
import { GetSalesOverTimeHandler } from "./queries/get-sales-over-time.handler";
import { GetSalesOverTimeQuery } from "./queries/get-sales-over-time.query";
import type { AnalyticsService } from "./analytics.service";

describe("analytics query handlers", () => {
  function fakeService() {
    return {
      revenue: jest.fn().mockResolvedValue({ totalRevenueCents: 1000, orderCount: 1, unitsSold: 2 }),
      topProducts: jest.fn().mockResolvedValue([{ productId: "p1", productName: "Mug", revenueCents: 1000, unitsSold: 2, orderLineCount: 1 }]),
      salesOverTime: jest.fn().mockResolvedValue([{ date: "2026-09-01T00:00:00.000Z", orderCount: 1, revenueCents: 1000, unitsSold: 2 }]),
    } as unknown as AnalyticsService;
  }

  test("GetRevenueHandler delegates to AnalyticsService.revenue(tenantId, range)", async () => {
    const analytics = fakeService();
    const handler = new GetRevenueHandler(analytics);
    const range = { from: "2026-09-01", to: "2026-09-30" };

    const result = await handler.execute(new GetRevenueQuery("tenant-1", range));

    expect(analytics.revenue).toHaveBeenCalledWith("tenant-1", range);
    expect(result).toEqual({ totalRevenueCents: 1000, orderCount: 1, unitsSold: 2 });
  });

  test("GetTopProductsHandler delegates to AnalyticsService.topProducts(tenantId, range)", async () => {
    const analytics = fakeService();
    const handler = new GetTopProductsHandler(analytics);
    const range = { from: "2026-09-01", to: "2026-09-30" };

    const result = await handler.execute(new GetTopProductsQuery("tenant-1", range));

    expect(analytics.topProducts).toHaveBeenCalledWith("tenant-1", range);
    expect(result).toEqual([{ productId: "p1", productName: "Mug", revenueCents: 1000, unitsSold: 2, orderLineCount: 1 }]);
  });

  test("GetSalesOverTimeHandler delegates to AnalyticsService.salesOverTime(tenantId, query)", async () => {
    const analytics = fakeService();
    const handler = new GetSalesOverTimeHandler(analytics);
    const query = { from: "2026-09-01", to: "2026-09-30", interval: "day" as const };

    const result = await handler.execute(new GetSalesOverTimeQuery("tenant-1", query));

    expect(analytics.salesOverTime).toHaveBeenCalledWith("tenant-1", query);
    expect(result).toEqual([{ date: "2026-09-01T00:00:00.000Z", orderCount: 1, revenueCents: 1000, unitsSold: 2 }]);
  });
});
