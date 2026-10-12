# @folkshops/emails

Transactional email for Folkshops: React Email templates plus a vendor-neutral `EmailProvider` (Resend in prod, console in dev). Only `apps/workers` sends email. See `docs/decisions/0013-transactional-email.md`.

```bash
pnpm --filter @folkshops/emails dev     # live preview of every template at http://localhost:3010
pnpm --filter @folkshops/emails build   # compile to dist/ — apps/workers imports the compiled output
```

## Adding a template

1. Create `src/templates/<name>.tsx`. It should default-export the component (with `PreviewProps`) and a `<name>Subject(props)` function, and wrap its content in `EmailLayout`.
2. Add it to `EmailTemplateProps` and `TEMPLATES` in `src/render.tsx`.
3. From a handler in `apps/workers`, call `enqueueEmail("<outboxId>-<name>[-<recipientId>]", { to, template: "<name>", props })`.
