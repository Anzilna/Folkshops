import { CreateProductHandler } from "./commands/create-product.handler";
import { UpdateProductHandler } from "./commands/update-product.handler";
import { GetProductHandler } from "./queries/get-product.handler";
import { ListProductsHandler } from "./queries/list-products.handler";
import { CreateProductCommand } from "./commands/create-product.command";
import { UpdateProductCommand } from "./commands/update-product.command";
import { GetProductQuery } from "./queries/get-product.query";
import { ListProductsQuery } from "./queries/list-products.query";
import type { ProductsService } from "./products.service";

/**
 * Each handler here is a one-line delegation — these tests exist to prove
 * exactly that: the handler calls the real ProductsService method with
 * the command/query's own fields, in order, and returns its value
 * verbatim. No business logic is under test here — that's
 * products.service.spec.ts's job (and ProductsService itself is
 * unchanged by this migration).
 */
describe("products command/query handlers", () => {
  function fakeService() {
    return {
      create: jest.fn().mockResolvedValue({ id: "p1" }),
      update: jest.fn().mockResolvedValue({ id: "p1", name: "updated" }),
      findById: jest.fn().mockResolvedValue({ id: "p1" }),
      list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
    } as unknown as ProductsService;
  }

  test("CreateProductHandler delegates to ProductsService.create(tenantId, dto)", async () => {
    const products = fakeService();
    const handler = new CreateProductHandler(products);
    const dto = { name: "Mug", slug: "mug", priceCents: 1000 } as never;

    const result = await handler.execute(new CreateProductCommand("tenant-1", dto));

    expect(products.create).toHaveBeenCalledWith("tenant-1", dto);
    expect(result).toEqual({ id: "p1" });
  });

  test("UpdateProductHandler delegates to ProductsService.update(tenantId, id, dto)", async () => {
    const products = fakeService();
    const handler = new UpdateProductHandler(products);
    const dto = { name: "renamed" } as never;

    const result = await handler.execute(new UpdateProductCommand("tenant-1", "p1", dto));

    expect(products.update).toHaveBeenCalledWith("tenant-1", "p1", dto);
    expect(result).toEqual({ id: "p1", name: "updated" });
  });

  test("GetProductHandler delegates to ProductsService.findById(tenantId, id)", async () => {
    const products = fakeService();
    const handler = new GetProductHandler(products);

    const result = await handler.execute(new GetProductQuery("tenant-1", "p1"));

    expect(products.findById).toHaveBeenCalledWith("tenant-1", "p1");
    expect(result).toEqual({ id: "p1" });
  });

  test("ListProductsHandler delegates to ProductsService.list(tenantId, query)", async () => {
    const products = fakeService();
    const handler = new ListProductsHandler(products);
    const query = { page: 1, limit: 20 } as never;

    const result = await handler.execute(new ListProductsQuery("tenant-1", query));

    expect(products.list).toHaveBeenCalledWith("tenant-1", query);
    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  });
});
