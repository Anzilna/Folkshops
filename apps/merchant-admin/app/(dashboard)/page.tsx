import { cookies } from "next/headers";
import { API_URL, TENANT_SLUG_COOKIE } from "../../lib/api";
import { DashboardAnalytics } from "./dashboard-analytics";
import { LogosOnboardingCard, StackOnboardingCard } from "./onboarding-card";

interface PaginatedCount {
  total: number;
}

interface PaymentAccountRow {
  live: boolean;
}

interface MeResponse {
  user: { email: string };
}

/**
 * Each checklist item reflects real tenant state, fetched server-side the
 * same way layout.tsx's own /auth/me check does (forward the incoming
 * cookies + dev tenant header). A step that's already done doesn't render
 * at all — no "coming soon"/disabled placeholders, and no fabricated
 * copy for capabilities that don't exist yet (shipping rates, store
 * naming — both dropped entirely, see CLAUDE.md/this page's history).
 */
export default async function DashboardPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const tenantSlug = cookieStore.get(TENANT_SLUG_COOKIE)?.value;
  const headers = {
    Cookie: cookieHeader,
    ...(tenantSlug ? { "X-Tenant-Id": tenantSlug } : {}),
  };

  const [productsRes, categoriesRes, paymentAccountRes, meRes] = await Promise.all([
    fetch(`${API_URL}/products?limit=1`, { headers, cache: "no-store" }),
    fetch(`${API_URL}/categories?limit=1`, { headers, cache: "no-store" }),
    fetch(`${API_URL}/payment-accounts/me`, { headers, cache: "no-store" }),
    // layout.tsx already verified this session — a second /auth/me call
    // here is just to read the email for the dashboard's greeting, not a
    // second auth check.
    fetch(`${API_URL}/auth/me`, { headers, cache: "no-store" }),
  ]);

  const hasProducts = productsRes.ok && ((await productsRes.json()) as PaginatedCount).total > 0;
  const hasCategories = categoriesRes.ok && ((await categoriesRes.json()) as PaginatedCount).total > 0;
  // PaymentAccountsService.getForTenant() returns `row ?? null` — Nest
  // serializes a null body as an empty response (Content-Length: 0), not
  // the JSON text "null", so .json() throws on a tenant that's never
  // connected an account. Read as text first and only parse if non-empty.
  const paymentAccountText = paymentAccountRes.ok ? await paymentAccountRes.text() : "";
  const paymentAccount = paymentAccountText ? (JSON.parse(paymentAccountText) as PaymentAccountRow) : null;
  const paymentsLive = paymentAccount?.live === true;
  const email = meRes.ok ? ((await meRes.json()) as MeResponse).user.email : "";

  const steps = [
    !hasProducts && (
      <StackOnboardingCard
        key="products"
        title="Add your first product"
        description="Products are managed via the API today — a dedicated page here is next."
        cta="Add a product"
        href="/products"
        delayMs={0}
      />
    ),
    !paymentsLive && (
      <LogosOnboardingCard
        key="payments"
        title="Set up payments"
        description="Accept cards and more — connect Stripe from Settings → Payments."
        cta="Activate payments"
        href="/settings/payments"
        delayMs={75}
        logos={["/payments/upi.svg", "/payments/rupay.svg", "/payments/visa.svg"]}
      />
    ),
    !hasCategories && (
      <StackOnboardingCard
        key="categories"
        title="Set up categories & inventory"
        description="Organize your catalog and track stock levels."
        cta="Set up"
        href="/categories"
        delayMs={150}
      />
    ),
  ].filter(Boolean);

  // The checklist and the analytics view are NOT mutually exclusive —
  // analytics reads from apps/analytics/Elasticsearch, which has no
  // dependency on onboarding completion (payments.live only gates the
  // storefront's actual checkout, a separate check in
  // PaymentsService.initiatePayment()). A store mid-setup can still have
  // real order history worth seeing, so the checklist sits above the
  // dashboard rather than hiding it. See docs/decisions/0009.
  return (
    <div className="flex flex-col gap-8">
      {steps.length > 0 && (
        <div>
          <h2 className="mb-1 text-lg font-medium">Get your store ready</h2>
          <p className="mb-5 text-sm text-muted-foreground">A few things to set up before you launch.</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{steps}</div>
        </div>
      )}

      <DashboardAnalytics email={email} />
    </div>
  );
}
