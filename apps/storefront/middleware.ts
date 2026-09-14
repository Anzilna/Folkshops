import { NextRequest, NextResponse } from "next/server";

/**
 * Same posture as merchant-admin's middleware: a cheap cookie-presence
 * check to avoid a flash of a protected page, never signature
 * verification (that stays in core-api's CustomerJwtAuthGuard). Unlike
 * the admin apps, most of this site is public — only the customer's own
 * cart and orders need a session.
 */
const ACCESS_TOKEN_COOKIE = "fk_customer_access_token";
const PROTECTED_PREFIXES = ["/cart", "/orders"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(ACCESS_TOKEN_COOKIE);

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) && !hasSession) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/login") && hasSession) {
    return NextResponse.redirect(new URL(req.nextUrl.searchParams.get("next") ?? "/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Exclude static files (paths with an extension) — see CLAUDE.md bug #4.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
