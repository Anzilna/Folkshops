import Link from "next/link";

export default function NotFound() {
  return (
    <div className="fk-fade-in mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <span className="sf-display text-6xl font-semibold text-muted-foreground/30">404</span>
      <h1 className="text-xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="text-sm text-muted-foreground">The link might be broken, or the page may have moved.</p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
      >
        Back to shop
      </Link>
    </div>
  );
}
