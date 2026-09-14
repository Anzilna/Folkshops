"use client";

import { useState } from "react";
import type { Product } from "../../../lib/api";
import { ProductArt } from "../../product-card";

/**
 * Cover image (product.imageUrl, via ProductArt — includes the tint+
 * initial fallback for products with no photos at all) plus the gallery
 * (product.images) as a thumbnail strip that swaps the main image on
 * click. Client-only because it's just local UI state (which photo is
 * showing) — nothing here needs a round trip.
 */
export function ProductGallery({ product }: { product: Product }) {
  const all = product.imageUrl ? [product.imageUrl, ...product.images] : product.images;
  const [active, setActive] = useState(0);

  if (all.length === 0) {
    return <ProductArt product={product} className="aspect-square w-full" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-square w-full overflow-hidden rounded-2xl bg-muted/30">
        {/* eslint-disable-next-line @next/next/no-img-element -- external S3/MinIO URL */}
        <img src={all[active]} alt={product.name} className="h-full w-full object-cover" />
      </div>
      {all.length > 1 && (
        <div className="flex gap-2">
          {all.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === active}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border transition-colors ${
                i === active ? "border-foreground" : "border-border hover:border-foreground/40"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- external S3/MinIO URL */}
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
