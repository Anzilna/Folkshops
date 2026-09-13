import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Two visual variants of the same card shape, modeled on Shopify admin's
 * home-page setup checklist: a "stack" variant (2-3 rotated tiles behind
 * the heading, like their "Choose your store design" card) for the one
 * thing a new merchant should do first, and a plain icon variant for
 * everything else. Pure CSS (transforms + a keyframe animation defined in
 * globals.css) — no animation library, nothing here needs one.
 */

interface BaseCardProps {
  title: string;
  description: string;
  cta: string;
  href?: string;
  comingSoon?: boolean;
  delayMs: number;
}

function CardShell({
  title,
  description,
  cta,
  href,
  comingSoon,
  delayMs,
  children,
}: BaseCardProps & { children: ReactNode }) {
  const isLink = href && !comingSoon;

  return (
    <div
      className="animate-card-in flex flex-col gap-4 rounded-2xl border border-border bg-background p-6 opacity-0"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {isLink ? (
        href.startsWith("http") ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="w-fit rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98]"
          >
            {cta}
          </a>
        ) : (
          <Link
            href={href}
            className="w-fit rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98]"
          >
            {cta}
          </Link>
        )
      ) : (
        <span className="w-fit rounded-full bg-muted px-4 py-1.5 text-sm font-medium text-muted-foreground">
          {comingSoon ? "Coming soon" : cta}
        </span>
      )}
    </div>
  );
}

/** The real product photos — only ones actually provided, no invented placeholder illustrations. */
const PRODUCT_IMAGE_POOL = ["/products/tracksuit.png", "/products/striped-shirt.png", "/products/denim-jacket.png"];

/**
 * Fixed slot styling for up to 4 stacked tiles — index = stacking position,
 * not which image. Sized deliberately large (128px tiles) — allowed to
 * bleed past the card's own edge rather than shrinking to fit, matching
 * the reference's oversized, slightly-overflowing product photos.
 */
const SLOT_STYLES = [
  "left-0 top-4 -rotate-8 group-hover:-translate-x-2 group-hover:-translate-y-1 group-hover:-rotate-12 z-10",
  "left-20 top-0 rotate-6 group-hover:translate-x-2 group-hover:rotate-10 z-20",
  "left-8 top-6 -rotate-2 group-hover:-translate-y-1.5 z-30",
  "left-32 top-2 rotate-3 group-hover:translate-x-1.5 group-hover:rotate-6 z-0",
];

function pickRandomImages(): string[] {
  const count = 2 + Math.floor(Math.random() * 3); // 2, 3, or 4
  const shuffled = [...PRODUCT_IMAGE_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/** The "hero" card — a stack of rotated product-image tiles that fan out further on hover. */
export function StackOnboardingCard(props: BaseCardProps) {
  const images = pickRandomImages();

  return (
    <CardShell {...props}>
      <div className="group relative h-44 w-full overflow-visible">
        {images.map((src, i) => (
          <div
            key={src}
            className={`absolute h-32 w-32 overflow-hidden rounded-xl border border-border shadow-lg transition-transform duration-300 ease-out ${SLOT_STYLES[i]}`}
          >
            <Image src={src} alt="" fill sizes="128px" className="object-cover" />
          </div>
        ))}
      </div>
    </CardShell>
  );
}

/**
 * FixedImageCard: same tilted-tile treatment as StackOnboardingCard, but for an explicit
 * fixed image list instead of a random pool — for cards where a specific
 * image (or specific combination) makes more sense than a random one.
 * A single image gets one large centered tile instead of the fan-out.
 */
export function FixedImageCard(props: BaseCardProps & { images: string[]; fit?: "cover" | "contain" }) {
  const { images, fit = "cover", ...rest } = props;

  if (images.length === 1) {
    return (
      <CardShell {...rest}>
        <div className="group relative h-44 w-full overflow-visible">
          <div className="absolute left-4 top-2 h-40 w-56 -rotate-2 overflow-hidden rounded-xl border border-border shadow-lg transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:rotate-0">
            <Image src={images[0]} alt="" fill sizes="224px" className={fit === "cover" ? "object-cover" : "object-contain p-2"} />
          </div>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell {...rest}>
      <div className="group relative h-44 w-full overflow-visible">
        {images.map((src, i) => (
          <div
            key={src}
            className={`absolute h-32 w-32 overflow-hidden rounded-xl border border-border shadow-lg transition-transform duration-300 ease-out ${SLOT_STYLES[i]}`}
          >
            <Image src={src} alt="" fill sizes="128px" className={fit === "cover" ? "object-cover" : "object-contain p-2"} />
          </div>
        ))}
      </div>
    </CardShell>
  );
}

/** Same large-tilted-card treatment as the product stack, sized for the payment logos' own card shape. */
const LOGO_SLOT_STYLES = [
  "left-0 top-10 -rotate-6 group-hover:-translate-x-2 group-hover:-translate-y-1 group-hover:-rotate-10 z-10",
  "left-24 top-0 rotate-4 group-hover:-translate-y-1 group-hover:rotate-6 z-20",
  "left-48 top-12 rotate-8 group-hover:translate-x-2 group-hover:rotate-12 z-0",
];

/** Real payment network marks (UPI/RuPay/Visa) — each SVG already draws its own card shape, so no extra box/border here, just size + a drop shadow. */
export function LogosOnboardingCard(props: BaseCardProps & { logos: string[] }) {
  const { logos, ...rest } = props;
  return (
    <CardShell {...rest}>
      <div className="group relative h-44 w-full overflow-visible">
        {logos.map((src, i) => (
          <div
            key={src}
            className={`absolute h-24 w-36 drop-shadow-lg transition-transform duration-300 ease-out ${LOGO_SLOT_STYLES[i]}`}
          >
            <Image src={src} alt="" fill sizes="144px" className="object-contain" />
          </div>
        ))}
      </div>
    </CardShell>
  );
}
