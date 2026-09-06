import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { TenantsService } from "../tenants/tenants.service";

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
}

declare module "express-serve-static-core" {
  interface Request {
    tenantContext?: TenantContext;
  }
}

/**
 * `nike.folkshops.com` -> "nike". Apex/marketing domains (`folkshops.com`,
 * `localhost`) and `www` resolve to no tenant on purpose — the marketing
 * site is not a storefront (see product spec).
 */
function extractSlugFromHost(host: string | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();
  const parts = hostname.split(".");
  if (parts.length <= 2 || parts[0] === "www") return null;
  return parts[0];
}

/**
 * Resolves trusted tenant context for every request, before any guard runs.
 * Hostname is the production source of truth; the `X-Tenant-Id` header is a
 * dev-only convenience for local curl/testing without real subdomains and
 * must never be honored outside development (rule 9).
 */
@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantsService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    let slug: string | null = null;

    if (process.env.NODE_ENV !== "production") {
      slug = req.header("x-tenant-id") ?? null;
    }

    if (!slug) {
      slug = extractSlugFromHost(req.header("host"));
    }

    if (slug) {
      const tenant = await this.tenants.findBySlug(slug);
      if (tenant) {
        req.tenantContext = { id: tenant.id, slug: tenant.slug, name: tenant.name };
      }
    }

    next();
  }
}
