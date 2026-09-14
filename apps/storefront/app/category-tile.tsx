import Link from "next/link";
import type { Category } from "../lib/api";
import { hueFor } from "../lib/format";

/** Visual category entry point for the home page — same tint-from-name
 * technique as ProductArt, so categories and products read as one system
 * even though neither has real photography yet. */
export function CategoryTile({ category, index }: { category: Category; index: number }) {
  const hue = hueFor(category.name);
  return (
    <Link
      href={`/?category=${category.id}`}
      style={{ animationDelay: `${index * 40}ms` }}
      className="fk-fade-in group relative flex aspect-[4/3] shrink-0 w-40 flex-col justify-end overflow-hidden rounded-2xl p-4 transition-transform duration-150 ease-out active:scale-[0.98] sm:w-auto"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 transition-transform duration-300 ease-out group-hover:scale-105"
        style={{ background: `linear-gradient(150deg, oklch(0.92 0.05 ${hue}) 0%, oklch(0.82 0.08 ${(hue + 50) % 360}) 100%)` }}
      />
      <span className="relative text-sm font-semibold" style={{ color: `oklch(0.32 0.09 ${hue})` }}>
        {category.name}
      </span>
    </Link>
  );
}
