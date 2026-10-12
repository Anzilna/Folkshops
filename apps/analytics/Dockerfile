# Local development only — same posture as apps/core-api/Dockerfile: used by
# docker-compose.yml so `docker compose up` can run apps/analytics without a
# separate terminal. Not a production image (no multi-stage build, runs
# `nest start --watch` against docker-compose's bind mount). Real deployment
# is Phase 6 (folkshops-infra), out of scope here.
FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app

# Whole repo, not just this app's manifest — pnpm's --frozen-lockfile needs
# every workspace member's package.json. See apps/core-api/Dockerfile.
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/analytics

EXPOSE 4100

# @folkshops/events ships compiled JS (dist/), which .dockerignore excludes
# and the bind mount may not have yet on a fresh clone — build it before
# starting, same as step 4 of the README's native analytics setup.
CMD ["sh", "-c", "pnpm --filter @folkshops/events build && pnpm dev"]
