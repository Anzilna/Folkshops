import { CheckoutHandler } from "./commands/checkout.handler";
import { CheckoutCommand } from "./commands/checkout.command";
import { GetOrderHandler } from "./queries/get-order.handler";
import { GetOrderQuery } from "./queries/get-order.query";
import { ListOrdersHandler } from "./queries/list-orders.handler";
import { ListOrdersQuery } from "./queries/list-orders.query";
import { GetCustomerOrderHandler } from "./queries/get-customer-order.handler";
import { GetCustomerOrderQuery } from "./queries/get-customer-order.query";
import { ListCustomerOrdersHandler } from "./queries/list-customer-orders.handler";
import { ListCustomerOrdersQuery } from "./queries/list-customer-orders.query";
import type { OrdersService } from "./orders.service";

/**
 * Covers both the staff-side and customer-side handlers, deliberately in
 * one file — the point being tested (docs/decisions/0010's collision-risk
 * note) is that GetOrderQuery/GetCustomerOrderQuery are DISTINCT classes
 * each calling the same OrdersService.findById() signature, not that
 * they're wired into different NestJS modules (that's what the live
 * boot-and-hit-both-endpoints check in the plan's Verification section
 * covers — a unit test can't observe DI-instance separation).
 */
describe("orders command/query handlers", () => {
  function fakeService() {
    return {
      checkout: jest.fn().mockResolvedValue({ id: "order-1", status: "pending" }),
      findById: jest.fn().mockResolvedValue({ id: "order-1", customerId: "cust-1" }),
      listForTenant: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
      listForCustomer: jest.fn().mockResolvedValue([{ id: "order-1" }]),
    } as unknown as OrdersService;
  }

  test("CheckoutHandler delegates to OrdersService.checkout(tenantId, customerId)", async () => {
    const orders = fakeService();
    const handler = new CheckoutHandler(orders);

    const result = await handler.execute(new CheckoutCommand("tenant-1", "cust-1"));

    expect(orders.checkout).toHaveBeenCalledWith("tenant-1", "cust-1");
    expect(result).toEqual({ id: "order-1", status: "pending" });
  });

  test("GetOrderHandler (staff) delegates to OrdersService.findById(tenantId, id)", async () => {
    const orders = fakeService();
    const handler = new GetOrderHandler(orders);

    const result = await handler.execute(new GetOrderQuery("tenant-1", "order-1"));

    expect(orders.findById).toHaveBeenCalledWith("tenant-1", "order-1");
    expect(result).toEqual({ id: "order-1", customerId: "cust-1" });
  });

  test("GetCustomerOrderHandler (customer) delegates to the SAME OrdersService.findById(tenantId, id) signature", async () => {
    const orders = fakeService();
    const handler = new GetCustomerOrderHandler(orders);

    const result = await handler.execute(new GetCustomerOrderQuery("tenant-1", "order-1"));

    expect(orders.findById).toHaveBeenCalledWith("tenant-1", "order-1");
    expect(result).toEqual({ id: "order-1", customerId: "cust-1" });
  });

  test("ListOrdersHandler (staff) delegates to OrdersService.listForTenant(tenantId, query)", async () => {
    const orders = fakeService();
    const handler = new ListOrdersHandler(orders);
    const query = { page: 1, limit: 20 } as never;

    const result = await handler.execute(new ListOrdersQuery("tenant-1", query));

    expect(orders.listForTenant).toHaveBeenCalledWith("tenant-1", query);
    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  });

  test("ListCustomerOrdersHandler (customer) delegates to OrdersService.listForCustomer(tenantId, customerId)", async () => {
    const orders = fakeService();
    const handler = new ListCustomerOrdersHandler(orders);

    const result = await handler.execute(new ListCustomerOrdersQuery("tenant-1", "cust-1"));

    expect(orders.listForCustomer).toHaveBeenCalledWith("tenant-1", "cust-1");
    expect(result).toEqual([{ id: "order-1" }]);
  });
});
