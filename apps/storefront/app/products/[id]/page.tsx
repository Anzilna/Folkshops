import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CUSTOMER_ACCESS_TOKEN_COOKIE, serverFetch, type Category, type Product } from "../../../lib/api";
import { renderDescription } from "../../../lib/editorjs-render";
import { formatPrice } from "../../../lib/format";
import { ProductArt } from "../../product-card";
import { AddToCart } from "./add-to-cart";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [res, cookieStore] = await Promise.all([serverFetch(`/products/${id}`), cookies()]);
  if (!res.ok) notFound();
  const product: Product = await res.json();
  // Drafts and archived products are reachable by id but not for sale.
  if (product.status !== "active") notFound();

  let category: Category | null = null;
  if (product.categoryId) {
    const c = await serverFetch(`/categories/${product.categoryId}`);
    if (c.ok) category = await c.json();
  }

  return (
    <div className="flex flex-col gap-8">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-foreground">
          Shop
        </Link>
        {category && (
          <>
            <span aria-hidden="true">/</span>
            <Link href={`/?category=${category.id}`} className="hover:text-foreground">
              {category.name}
            </Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span className="truncate text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        <ProductArt product={product} className="aspect-square w-full" />

        <div className="flex flex-col gap-6 lg:py-4">
          <div className="flex flex-col gap-2">
            {category && <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{category.name}</span>}
            <h1 className="sf-display text-3xl font-semibold">{product.name}</h1>
            <p className="text-xl tabular-nums">{formatPrice(product.priceCents)}</p>
          </div>

          <AddToCart productId={product.id} signedIn={cookieStore.has(CUSTOMER_ACCESS_TOKEN_COOKIE)} />

          {product.description && (
            <div className="flex flex-col gap-2 border-t border-border pt-6">
              <h2 className="text-sm font-medium">About</h2>
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:font-medium [&_h3]:text-foreground [&_a]:underline [&_a]:underline-offset-2">
                {renderDescription(product.description)}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">Payment and delivery options arrive in Phase 2 — orders are recorded as pending for now.</p>
        </div>
      </div>
    </div>
  );
}
