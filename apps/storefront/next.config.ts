import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@folkshops/ui"],
  // A same-origin proxy for every browser-side API call (lib/api.ts's
  // apiFetch, not serverFetch — server-to-server calls were never the
  // problem). Found live: OTP verify genuinely returned 201 with correct
  // Set-Cookie headers, but the browser's cookie jar stayed empty and the
  // storefront just sat on the signed-out header — because the storefront
  // is served per-tenant from a *subdomain* (nike.localhost,
  // demo.localhost, ...), a fetch() straight to core-api's own
  // "localhost:4000" is genuinely cross-*site*, not just cross-origin:
  // "localhost" isn't on the public suffix list, so Chrome computes each
  // "X.localhost" as its own registrable domain. `SameSite=Lax` silently
  // drops the cookie on that cross-site POST (confirmed: empty cookie jar
  // either way tried), and the only alternative, `SameSite=None`, requires
  // `Secure`, which in turn requires the *request* itself to be HTTPS —
  // which plain `http://localhost` dev doesn't have (also confirmed live:
  // the cookie got stored but never sent back). No cookie-attribute
  // combination fixes this over plain HTTP.
  //
  // The actual fix is architectural, not a cookie tweak: never let the
  // browser talk to core-api directly. Every apiFetch call now hits
  // "/api/..." on the storefront's own origin; Next.js proxies it to
  // core-api server-to-server (never subject to SameSite/CORS at all,
  // same reasoning as serverFetch already not having this problem). The
  // browser only ever sees a response from its own exact origin
  // (nike.localhost:3000, demo.localhost:3000, ...), so Set-Cookie's
  // implicit domain becomes that origin — host-only, correctly scoped,
  // zero special cookie handling needed. This isn't a dev-only hack: it
  // also removes a genuine cross-origin request/response hop in
  // production, once a real API domain exists there too.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
