# @folkshops/storefront

Tenant-facing storefront (e.g. nike.folkshops.com) — Next.js (App Router) + Tailwind CSS v4.

Scaffolding only — no real pages yet. `POST /products`-backed catalog UI comes next, once `core-api`'s
`products` module has something worth rendering against.

## Local development

```bash
pnpm --filter @folkshops/storefront dev
```

Runs on http://localhost:3000. Does not talk to `core-api` yet — no data fetching wired up.
