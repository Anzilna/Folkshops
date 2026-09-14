import { NextRequest, NextResponse } from "next/server";

/**
 * Cheap presence check only — not signature verification. Verifying the
 * JWT here would mean duplicating JWT_SECRET into this app, a secret this
 * app has no other reason to hold. Real validation happens where it
 * already lives: core-api's JwtAuthGuard, via the /auth/me call each
 * protected page makes. This middleware's only job is avoiding a
 * flash-of-protected-content by redirecting before render when the cookie
 * is obviously absent; an expired/forged cookie still gets caught
 * server-side and bounced to /login from there.
 */
const ACCESS_TOKEN_COOKIE = "fk_access_token";
const PUBLIC_PATHS = ["/login", "/register"];

export function middleware(req: NextRequest) {
  const isPublic = PUBLIC_PATHS.some((path) => req.nextUrl.pathname.startsWith(path));
  const hasSession = req.cookies.has(ACCESS_TOKEN_COOKIE);

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
