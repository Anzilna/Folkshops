# Local development only — used by docker-compose.yml so `docker compose up`
# can run core-api alongside Postgres/Redis without a separate terminal.
# Not a production image: no multi-stage build, no compiled dist/ output,
# runs `nest start --watch` for hot reload via docker-compose's bind mount.
# Real deployment is Phase 6 (separate folkshops-infra repo — Terraform,
# Helm, Argo CD), out of scope here.
FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app

# pnpm's lockfile is workspace-wide — `--frozen-lockfile` needs every
# workspace member's package.json present, not just core-api's, so this
# copies the whole repo rather than cherry-picking manifests. Slower to
# rebuild the install layer on a source change than a hand-tuned
# production Dockerfile would be, which is an acceptable tradeoff for a
# dev-only image whose actual source comes from a bind mount at runtime,
# not this COPY.
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/core-api

EXPOSE 4000

CMD ["sh", "-c", "pnpm db:migrate && pnpm dev"]
