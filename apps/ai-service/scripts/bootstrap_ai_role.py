"""
Creates (or updates) folkshops_ai on any Postgres target — RDS included.
database/init/02-ai-role.sql only creates the role on a FRESH local Docker
volume (docker-entrypoint-initdb.d only runs once, on first init); this
script covers every other case, and is safe to re-run — same split as
core-api's own bootstrap-app-role.ts / bootstrap-debezium-role.ts.

Usage:
    MIGRATIONS_DATABASE_URL=<schema-owning/admin connection> \\
    AI_DB_PASSWORD=<a real secret, never hardcoded, dev default is folkshops_ai> \\
    python scripts/bootstrap_ai_role.py
"""

import asyncio
import os
import sys

import asyncpg


async def main() -> None:
    admin_url = os.environ.get("MIGRATIONS_DATABASE_URL")
    password = os.environ.get("AI_DB_PASSWORD", "folkshops_ai")
    if not admin_url:
        print("MIGRATIONS_DATABASE_URL is required (the schema-owning/admin connection).", file=sys.stderr)
        sys.exit(1)

    conn = await asyncpg.connect(admin_url)
    try:
        escaped = password.replace("'", "''")
        await conn.execute(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'folkshops_ai') THEN
                    CREATE ROLE folkshops_ai LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{escaped}';
                ELSE
                    ALTER ROLE folkshops_ai WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{escaped}';
                END IF;
            END
            $$;
        """)
        await conn.execute("GRANT USAGE ON SCHEMA public TO folkshops_ai")

        row = await conn.fetchrow(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'folkshops_ai'"
        )
        if row["rolsuper"] or row["rolbypassrls"]:
            print(
                f"folkshops_ai has rolsuper={row['rolsuper']} rolbypassrls={row['rolbypassrls']} — "
                "refusing to continue; RLS would be silently bypassed.",
                file=sys.stderr,
            )
            sys.exit(1)

        print("folkshops_ai is ready: rolsuper=false, rolbypassrls=false.")
        print("Run `python -m app.infrastructure.persistence.postgres` migrations (or start the service) next.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
