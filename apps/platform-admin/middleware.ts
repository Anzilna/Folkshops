import { NextRequest, NextResponse } from "next/server";

/**
 * Cheap presence check only — not signature verification. Same reasoning
 * as merchant-admin's middleware: real validation happens server-side via
 * core-api's PlatformAdminJwtAuthGuard, through the /platform-admin/auth/me
 * call each protected page makes.
 */
const ACCESS_TOKEN_COOKIE = "fk_pa_access_token";
const PUBLIC_PATHS = ["/login"];

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
  // Excludes static files (anything with a file extension) — see
  // merchant-admin's middleware.ts for why (found via testing: asset
  // requests were getting redirected to /login for anonymous requests).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
