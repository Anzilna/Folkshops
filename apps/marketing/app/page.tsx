import { FeatureCard } from "./feature-card";
import { MERCHANT_ADMIN_URL, STOREFRONT_URL } from "../lib/urls";

const FEATURES = [
  {
    icon: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M12 13v8",
    title: "Your own store, isolated by design",
    description: "Every store's data is kept apart at the database layer itself (Row-Level Security), not just by application code — the same safeguard real banks rely on.",
  },
  {
    icon: "M6 3h12l1 5H5l1-5zM5 8h14l-1.2 11.2A2 2 0 0115.8 21H8.2a2 2 0 01-2-1.8L5 8zM9 12h6",
    title: "Full catalog control",
    description: "Products, categories, and live stock counts — with photo galleries and rich descriptions, editable in one place.",
  },
  {
    icon: "M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19M9 11a3 3 0 100-6 3 3 0 000 6zM20 19v-1.5a3 3 0 00-2.5-2.96M15 4.1a3 3 0 010 5.8",
    title: "No-password customer login",
    description: "Shoppers sign in with just their phone number and a one-time code — no account to remember, no friction before checkout.",
  },
  {
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 14l2 2 4-4",
    title: "Orders, tracked from cart to confirmation",
    description: "Every checkout is recorded with a full line-item snapshot, so what a customer paid never shifts even if you update a price later.",
  },
  {
    icon: "M12 8c-3.5 0-6.5 2-8 5 1.5 3 4.5 5 8 5s6.5-2 8-5c-1.5-3-4.5-5-8-5zM12 13a1 1 0 100-2 1 1 0 000 2z",
    title: "Nothing hidden, nothing shared",
    description: "One tenant can never see another's customers, orders, or inventory — enforced independently at three separate layers, not just trusted to app code.",
  },
  {
    icon: "M12 2l2.4 7.2H22l-6 4.4 2.4 7.2L12 16.4 5.6 20.8 8 13.6l-6-4.4h7.6L12 2z",
    title: "Priced for India, from day one",
    description: "Every amount is stored and shown in rupees and paise natively — not retrofitted from a dollar-first system.",
  },
];

const STEPS = [
  { n: "01", title: "Create your store", body: "Pick a name and a URL. Your store exists the moment you submit the form — no waiting, no approval queue." },
  { n: "02", title: "Add what you sell", body: "Products, categories, photos, stock counts. Import a spreadsheet if you already have one, or add items one at a time." },
  { n: "03", title: "Start selling", body: "Share your store's link. Customers sign in with a phone number and buy — you see every order the moment it's placed." },
];

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <section className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 sm:py-28">
        <span className="fk-fade-in rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">India-first e-commerce, built for one store or many</span>
        <h1 className="fk-fade-in mk-display max-w-3xl text-5xl font-semibold sm:text-6xl lg:text-7xl" style={{ animationDelay: "60ms" }}>
          Run your online store without renting someone else&apos;s.
        </h1>
        <p className="fk-fade-in max-w-xl text-lg text-muted-foreground" style={{ animationDelay: "120ms" }}>
          Folkshops gives you a real storefront, a real dashboard, and real data isolation — built specifically for merchants selling in India.
        </p>
        <div className="fk-fade-in flex flex-wrap items-center gap-3" style={{ animationDelay: "180ms" }}>
          <a
            href={`${MERCHANT_ADMIN_URL}/register`}
            className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Start selling — it&apos;s free
          </a>
          <a
            href={STOREFRONT_URL}
            className="rounded-full border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            See a live store &rarr;
          </a>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30 py-20">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6">
          <div className="flex flex-col gap-2">
            <h2 className="mk-display text-3xl font-semibold sm:text-4xl">Everything a store needs, already built in</h2>
            <p className="max-w-xl text-muted-foreground">No plugins to install, no separate services to wire up.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <FeatureCard key={f.title} icon={f.icon} title={f.title} description={f.description} index={i} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6">
          <h2 className="mk-display text-3xl font-semibold sm:text-4xl">From idea to open for business</h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.n} className="fk-fade-in flex flex-col gap-2" style={{ animationDelay: `${i * 60}ms` }}>
                <span className="text-sm font-semibold text-accent">{s.n}</span>
                <h3 className="text-base font-semibold">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-6 py-20">
          <h2 className="mk-display text-3xl font-semibold sm:text-4xl">Your store, your rules.</h2>
          <a
            href={`${MERCHANT_ADMIN_URL}/register`}
            className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Create your store
          </a>
        </div>
      </section>
    </div>
  );
}
