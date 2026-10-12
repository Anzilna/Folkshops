/**
 * Creates a real Stripe Product + Price for every paid plan that doesn't
 * have a stripe_price_id yet, and writes the resulting price id back onto
 * the row. Safe to re-run — a plan that already has a stripe_price_id is
 * skipped (Stripe Prices are immutable; changing a plan's price means
 * clearing stripe_price_id on that row first, then re-running this, which
 * creates a genuinely new Price rather than editing the old one).
 *
 * Usage:
 *   DATABASE_PRIMARY_URL=<app-role connection> STRIPE_SECRET_KEY=sk_test_... \
 *   pnpm --filter @folkshops/core-api db:bootstrap-stripe-plans
 */
import { Pool } from "pg";
import Stripe from "stripe";

async function main() {
  const databaseUrl = process.env.DATABASE_PRIMARY_URL;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!databaseUrl) throw new Error("DATABASE_PRIMARY_URL is required.");
  if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is required.");

  const stripe = new Stripe(stripeSecretKey);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const { rows: plans } = await pool.query<{ id: string; slug: string; name: string; price_cents: number; currency: string }>(
      "SELECT id, slug, name, price_cents, currency FROM plans WHERE price_cents > 0 AND stripe_price_id IS NULL",
    );

    if (plans.length === 0) {
      console.log("No paid plans need a Stripe Price — nothing to do.");
      return;
    }

    for (const plan of plans) {
      const product = await stripe.products.create({ name: `Folkshops — ${plan.name}` });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.price_cents,
        currency: plan.currency,
        recurring: { interval: "month" },
      });
      await pool.query("UPDATE plans SET stripe_price_id = $1, updated_at = now() WHERE id = $2", [price.id, plan.id]);
      console.log(`${plan.slug}: created Stripe Price ${price.id} (${plan.price_cents / 100} ${plan.currency}/mo)`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
