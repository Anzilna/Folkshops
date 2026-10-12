# @folkshops/platform-admin

Internal Folkshops staff app — Next.js (App Router) + Tailwind CSS v4. A separate auth boundary from merchants: its own JWT secret and cookie pair, not tenant members.

Pages: **Dashboard** (live platform summary), **Tenants** (list → store detail with suspend/reactivate), **Plans** (read-only), **Activity** (audit log), **Team** (add/remove admins), **Settings** (change your own password). The header bell shows real platform events. Full design, the layers that enforce a suspension, and what isn't built: `docs/decisions/0016-platform-admin.md`.

## Local development

```bash
pnpm --filter @folkshops/platform-admin dev      # http://localhost:3002
```

There is no signup. The first admin comes from a script (it upserts, so re-running resets a password):

```bash
DATABASE_PRIMARY_URL=postgres://folkshops_app:folkshops_app@localhost:5432/folkshops_dev \
PLATFORM_ADMIN_EMAIL=you@folkshops.com \
PLATFORM_ADMIN_PASSWORD='choose-a-password' \
PLATFORM_ADMIN_NAME="Your Name" \
pnpm --filter @folkshops/core-api db:bootstrap-platform-admin
```

After that, admins add each other from **Team**.
