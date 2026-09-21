import { mapCategoryRow, mapProductRow } from "./map-cdc-row";

describe("mapProductRow", () => {
  test("maps Debezium's snake_case row onto product-search's camelCase mapping fields", () => {
    const row = {
      id: "prod-1",
      tenant_id: "tenant-1",
      category_id: "cat-1",
      name: "Coffee Mug",
      slug: "coffee-mug",
      description: "A mug",
      price_cents: 5000,
      status: "active",
      is_active: true,
      deleted_at: null,
      image_url: "https://example.test/mug.png",
      updated_at: "2026-09-19T10:00:00.000Z",
    };

    expect(mapProductRow(row, 1758277200000)).toEqual({
      productId: "prod-1",
      tenantId: "tenant-1",
      categoryId: "cat-1",
      name: "Coffee Mug",
      slug: "coffee-mug",
      description: "A mug",
      priceCents: 5000,
      status: "active",
      isActive: true,
      deletedAt: null,
      imageUrl: "https://example.test/mug.png",
      updatedAt: "2026-09-19T10:00:00.000Z",
      lastCdcTsMs: 1758277200000,
    });
  });

  test("a soft-deleted product (deleted_at set) still maps — CDC never sees a hard DELETE for this table", () => {
    const row = {
      id: "prod-2",
      tenant_id: "tenant-1",
      category_id: null,
      name: "Old Product",
      slug: "old-product",
      description: null,
      price_cents: 1000,
      status: "archived",
      is_active: false,
      deleted_at: "2026-09-18T00:00:00.000Z",
      image_url: null,
      updated_at: "2026-09-18T00:00:00.000Z",
    };

    const doc = mapProductRow(row, 1758190800000);
    expect(doc.deletedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(doc.isActive).toBe(false);
  });
});

describe("mapCategoryRow", () => {
  test("maps Debezium's snake_case row onto category-search's camelCase mapping fields", () => {
    const row = {
      id: "cat-1",
      tenant_id: "tenant-1",
      name: "Drinkware",
      slug: "drinkware",
      description: null,
      is_active: true,
      deleted_at: null,
      updated_at: "2026-09-19T09:00:00.000Z",
    };

    expect(mapCategoryRow(row, 1758273600000)).toEqual({
      categoryId: "cat-1",
      tenantId: "tenant-1",
      name: "Drinkware",
      slug: "drinkware",
      description: null,
      isActive: true,
      deletedAt: null,
      updatedAt: "2026-09-19T09:00:00.000Z",
      lastCdcTsMs: 1758273600000,
    });
  });
});
