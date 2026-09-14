import Link from "next/link";
import type { Product } from "../lib/api";
import { formatPrice, hueFor } from "../lib/format";

/** Real image when a merchant has uploaded one; otherwise a stable
 * per-product tint + initial, so a catalog with only some products
 * photographed still reads as a catalog, not a wall of grey placeholders
 * next to real photos. */
export function ProductArt({ product, className = "" }: { product: Product; className?: string }) {
  if (product.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- external S3/MinIO URL, not a local asset next/image can optimize
    return <img src={product.imageUrl} alt={product.name} className={`rounded-2xl object-cover ${className}`} />;
  }

  const hue = hueFor(product.name);
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center overflow-hidden rounded-2xl ${className}`}
      style={{ background: `linear-gradient(135deg, oklch(0.94 0.04 ${hue}) 0%, oklch(0.88 0.06 ${(hue + 40) % 360}) 100%)` }}
    >
      <span className="select-none text-5xl font-semibold" style={{ color: `oklch(0.5 0.1 ${hue})` }}>
        {product.name.charAt(0)}
      </span>
    </div>
  );
}

export function ProductCard({ product, categoryName }: { product: Product; categoryName?: string }) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="group flex flex-col gap-3 rounded-2xl transition-[transform] duration-150 ease-out active:scale-[0.99]"
    >
      <ProductArt product={product} className="aspect-square w-full transition-[box-shadow] duration-150 group-hover:shadow-md" />
      <div className="flex flex-col gap-0.5 px-0.5">
        {categoryName && <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{categoryName}</span>}
        <span className="text-sm font-medium leading-snug text-foreground">{product.name}</span>
        <span className="text-sm text-muted-foreground tabular-nums">{formatPrice(product.priceCents)}</span>
      </div>
    </Link>
  );
}
