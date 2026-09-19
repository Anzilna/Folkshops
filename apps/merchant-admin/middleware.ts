import { NextRequest, NextResponse } from "next/server";

/**
 * Presence check for routing, plus one real thing: silently refreshing an
 * expired/missing access token using the refresh cookie before bouncing to
 * /login. Access tokens are 15 minutes (see CLAUDE.md's three-auth-surfaces
 * section) — without this, every page navigation more than 15 minutes
 * after login hit DashboardLayout's own `/auth/me` call, got a 401, and
 * redirected to /login even though a perfectly valid 30-day refresh token
 * was sitting right there unused. Found live: a real login, followed by
 * normal use past the 15-minute mark, kept bouncing back to /login.
 *
 * Still not JWT signature verification here — that stays in core-api's
 * JwtAuthGuard (this app never holds JWT_SECRET). The refresh call is a
 * real network round-trip to core-api's own /auth/refresh, which does the
 * actual verification/rotation; this middleware only forwards cookies in
 * both directions around that call.
 */
const ACCESS_TOKEN_COOKIE = "fk_access_token";
const REFRESH_TOKEN_COOKIE = "fk_refresh_token";
const PUBLIC_PATHS = ["/login", "/register"];
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function middleware(req: NextRequest) {
  const isPublic = PUBLIC_PATHS.some((path) => req.nextUrl.pathname.startsWith(path));
  const hasSession = req.cookies.has(ACCESS_TOKEN_COOKIE);

  if (!isPublic && !hasSession && req.cookies.has(REFRESH_TOKEN_COOKIE)) {
    const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: req.headers.get("cookie") ?? "" },
    });

    if (refreshRes.ok) {
      const setCookies = refreshRes.headers.getSetCookie();
      // Make the fresh access token visible to THIS request as it
      // continues to the page — without this, DashboardLayout's own
      // cookies() read still sees the browser's original (missing/expired)
      // cookie header, not the one just issued, and 401s anyway.
      const requestHeaders = new Headers(req.headers);
      const existingCookieHeader = requestHeaders.get("cookie") ?? "";
      const newPairs = setCookies.map((c) => c.split(";")[0]);
      requestHeaders.set("cookie", [existingCookieHeader, ...newPairs].filter(Boolean).join("; "));

      const response = NextResponse.next({ request: { headers: requestHeaders } });
      // And forward the same Set-Cookie headers to the browser, so future
      // requests carry the new access token too, not just this one.
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
  // Anything under public/ (images, icons, ...) is a static file request,
  // not a page navigation — excluding paths with a file extension (found
  // by testing: /products/*.svg was getting redirected to /login for an
  // anonymous request, harmless in practice since a real browser always
  // sends the session cookie alongside the page that references them, but
  // wasteful and not what this guard is for).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
