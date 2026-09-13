import { FixedImageCard, LogosOnboardingCard, StackOnboardingCard } from "./onboarding-card";

export default function DashboardPage() {
  return (
    <div>
      <h2 className="mb-1 text-lg font-medium">Get your store ready</h2>
      <p className="mb-5 text-sm text-muted-foreground">A few things to set up before you launch.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StackOnboardingCard
          title="Add your first product"
          description="Products are managed via the API today — a dedicated page here is next."
          cta="Add a product"
          href="/products"
          delayMs={0}
        />
        <LogosOnboardingCard
          title="Set up payments"
          description="Accept UPI, RuPay, and cards — Razorpay integration is planned for Phase 2."
          cta="Activate payments"
          comingSoon
          delayMs={75}
          logos={["/payments/upi.svg", "/payments/rupay.svg", "/payments/visa.svg"]}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* TODO: swap for the actual name-tag image once re-added — see conversation, the original was deleted. */}
        <FixedImageCard
          title="Name your store"
          description="Customers will see this across your storefront, emails, and checkout."
          cta="Add name"
          href="/settings"
          delayMs={150}
          images={["/dashboard/name-tag.png"]}
        />
        <FixedImageCard
          title="Set up categories & inventory"
          description="Organize your catalog and track stock levels."
          cta="Set up"
          href="/categories"
          delayMs={225}
          images={["/dashboard/_.jpeg"]}
        />
        {/* TODO: swap for the actual box image once re-added — see conversation, the original was deleted. */}
        <FixedImageCard
          title="Review shipping rates"
          description="Look over the defaults set up for you based on your location."
          cta="Review rates"
          href="/settings"
          delayMs={300}
          images={["/products/denim-jacket.png"]}
        />
      </div>
    </div>
  );
}
