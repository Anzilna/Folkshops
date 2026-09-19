import { NextRequest, NextResponse } from "next/server";

/**
 * Presence check for routing, plus one real thing: silently refreshing an
 * expired/missing access token using the refresh cookie before bouncing to
 * /login. Same fix, same reasoning, same bug as merchant-admin's own
 * middleware.ts (see its comment) — access tokens are 15 minutes, and
 * without this, any page navigation past that mark 401s against
 * /platform-admin/auth/me and redirects to /login even with a valid
 * 30-day refresh token sitting unused in a cookie.
 *
 * Still not JWT signature verification here — that stays in core-api's
 * PlatformAdminJwtAuthGuard (this app never holds PLATFORM_ADMIN_JWT_SECRET).
 */
const ACCESS_TOKEN_COOKIE = "fk_pa_access_token";
const REFRESH_TOKEN_COOKIE = "fk_pa_refresh_token";
const PUBLIC_PATHS = ["/login"];
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function middleware(req: NextRequest) {
  const isPublic = PUBLIC_PATHS.some((path) => req.nextUrl.pathname.startsWith(path));
  const hasSession = req.cookies.has(ACCESS_TOKEN_COOKIE);

  if (!isPublic && !hasSession && req.cookies.has(REFRESH_TOKEN_COOKIE)) {
    const refreshRes = await fetch(`${API_URL}/platform-admin/auth/refresh`, {
      method: "POST",
      headers: { Cookie: req.headers.get("cookie") ?? "" },
    });

    if (refreshRes.ok) {
      const setCookies = refreshRes.headers.getSetCookie();
      const requestHeaders = new Headers(req.headers);
      const existingCookieHeader = requestHeaders.get("cookie") ?? "";
      const newPairs = setCookies.map((c) => c.split(";")[0]);
      requestHeaders.set("cookie", [existingCookieHeader, ...newPairs].filter(Boolean).join("; "));

      const response = NextResponse.next({ request: { headers: requestHeaders } });
      for (const cookie of setCookies) response.headers.append("Set-Cookie", cookie);
      return response;
    }
    // Refresh token itself invalid/expired/revoked — fall through to the
    // normal redirect below, same as if no cookies existed at all.
  }

  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (isPublic && hasSession) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Excludes static files (anything with a file extension) — see
  // merchant-admin's middleware.ts for why (found via testing: asset
  // requests were getting redirected to /login for anonymous requests).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
