import type { Metadata } from "next";
import { API_URL, MERCHANT_ADMIN_URL } from "../../lib/urls";

export const metadata: Metadata = {
  title: "Pricing — Folkshops",
  description: "Simple, transparent pricing for stores of any size.",
};

// Never cached at the fetch layer — plans change rarely, but a stale price
// showing on a page that literally decides what someone gets charged is
// the one place staleness has a real cost (see docs/decisions/0012).
export const revalidate = 0;

interface Plan {
  slug: string;
  name: string;
  priceCents: number;
  currency: string;
  maxProducts: number | null;
  aiAccess: boolean;
}

async function getPlans(): Promise<Plan[]> {
  const res = await fetch(`${API_URL}/plans`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return "Free";
  return `${currency.toUpperCase()} ${(cents / 100).toLocaleString("en-AE")}`;
}

export default async function PricingPage() {
  const plans = await getPlans();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-20 sm:py-28">
      <div className="fk-fade-in flex flex-col gap-4">
        <h1 className="mk-display text-4xl font-semibold sm:text-5xl">Simple pricing, no surprises.</h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Pick the plan that fits your store today — switch anytime as you grow.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {plans.map((plan, i) => (
          <div
            key={plan.slug}
            className="fk-fade-in flex flex-col gap-6 rounded-2xl border border-border p-8"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="text-3xl font-semibold">
                {formatPrice(plan.priceCents, plan.currency)}
                {plan.priceCents > 0 && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
              </p>
            </div>

            <ul className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
              <li>{plan.maxProducts === null ? "Unlimited products" : `Up to ${plan.maxProducts} products`}</li>
              <li>{plan.aiAccess ? "AI assistant included" : "No AI assistant"}</li>
            </ul>

            <a
              href={`${MERCHANT_ADMIN_URL}/register?plan=${plan.slug}`}
              className="rounded-full bg-accent px-6 py-3 text-center text-sm font-medium text-accent-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              Get started
            </a>
          </div>
        ))}
      </div>

      {plans.length === 0 && (
        <p className="text-sm text-muted-foreground">Plans are temporarily unavailable — please try again shortly.</p>
      )}
    </div>
  );
}
