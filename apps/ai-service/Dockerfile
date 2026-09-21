# Optional container, same posture as core-api's own Dockerfile — native
# `uvicorn`/`arq` on the host works identically and is the faster dev loop;
# this exists so `docker compose up -d ai-service` also works for anyone
# who'd rather not run two more terminals. See docker-compose.yml.
FROM python:3.12-slim

WORKDIR /app

# libpq for asyncpg's C extension build step; removed from the final layer
# isn't worth the multi-stage complexity at this size (rule 30: don't
# over-engineer) — this image is dev/small-deployment sized, not a
# hyper-optimized production layer yet.
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 4400

HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD curl -sf http://localhost:4400/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4400"]
