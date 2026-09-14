import Link from "next/link";
import { serverFetch, type Category, type Paginated, type Product } from "../lib/api";
import { ProductCard } from "./product-card";

const PAGE_SIZE = 24;

interface SearchParams {
  q?: string;
  category?: string;
  page?: string;
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { q = "", category = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const query = new URLSearchParams({ status: "active", limit: String(PAGE_SIZE), page: String(page), sortBy: "createdAt", sortDir: "desc" });
  if (q) query.set("search", q);
  if (category) query.set("categoryId", category);

  const [productsRes, categoriesRes] = await Promise.all([
    serverFetch(`/products?${query}`),
    serverFetch("/categories?limit=100&sortBy=name"),
  ]);
  const products: Paginated<Product> = productsRes.ok ? await productsRes.json() : { data: [], total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 };
  const categories: Category[] = categoriesRes.ok ? (await categoriesRes.json()).data : [];
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  function pageHref(p: number) {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (category) sp.set("category", category);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/?${s}` : "/";
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <h1 className="sf-display text-3xl font-semibold sm:text-4xl">
          {category ? (categoryName.get(category) ?? "Shop") : "Shop"}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <form action="/" className="relative w-full sm:w-72">
            {category && <input type="hidden" name="category" value={category} />}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search products"
              className="h-10 w-full rounded-full border border-border bg-background pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </form>

          <div className="flex flex-wrap gap-1.5">
            <CategoryChip href={q ? `/?q=${encodeURIComponent(q)}` : "/"} active={!category}>
              All
            </CategoryChip>
            {categories.map((c) => (
              <CategoryChip key={c.id} href={`/?category=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} active={category === c.id}>
                {c.name}
              </CategoryChip>
            ))}
          </div>
        </div>
      </div>

      {products.data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-20 text-center">
          <p className="text-sm text-muted-foreground">{q || category ? "Nothing matches that." : "Nothing in the shop yet."}</p>
          {(q || category) && (
            <Link href="/" className="mt-3 inline-block text-sm underline underline-offset-4">
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {products.data.map((p) => (
            <ProductCard key={p.id} product={p} categoryName={p.categoryId ? categoryName.get(p.categoryId) : undefined} />
          ))}
        </div>
      )}

      {products.totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm text-muted-foreground" aria-label="Pagination">
          <span>
            {products.total} product{products.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-3">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="underline underline-offset-4 hover:text-foreground">
                Previous
              </Link>
            ) : (
              <span className="opacity-40">Previous</span>
            )}
            <span className="tabular-nums">
              {page} / {products.totalPages}
            </span>
            {page < products.totalPages ? (
              <Link href={pageHref(page + 1)} className="underline underline-offset-4 hover:text-foreground">
                Next
              </Link>
            ) : (
              <span className="opacity-40">Next</span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

function CategoryChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
