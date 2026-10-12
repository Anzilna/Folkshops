# @folkshops/workers

The outbox relay plus BullMQ workers (see `docs/decisions/0007`, `0009`, `0013`):

- `relay.ts`: polls `outbox_events` and enqueues each row onto the `outbox` queue. It also publishes the row to Kafka.
- `worker.ts`: dispatches each `outbox` job to a handler in `handlers/` based on its event type.
- `email-worker.ts`: consumes the `email` queue. It renders templates from `@folkshops/emails` and sends them through Resend, or logs them to the console when `RESEND_API_KEY` is unset.

```bash
pnpm --filter @folkshops/emails build   # workers import its compiled dist/
pnpm --filter @folkshops/workers dev
```
