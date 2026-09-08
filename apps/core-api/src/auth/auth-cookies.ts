import type { Response } from "express";

// Distinct cookie names per surface (not just distinct secrets) so a
// staff and a platform-admin session can coexist in the same browser
// without one overwriting the other's cookie.
export const STAFF_ACCESS_TOKEN_COOKIE = "fk_access_token";
export const STAFF_REFRESH_TOKEN_COOKIE = "fk_refresh_token";
export const PLATFORM_ADMIN_ACCESS_TOKEN_COOKIE = "fk_pa_access_token";
export const PLATFORM_ADMIN_REFRESH_TOKEN_COOKIE = "fk_pa_refresh_token";
export const CUSTOMER_ACCESS_TOKEN_COOKIE = "fk_customer_access_token";
export const CUSTOMER_REFRESH_TOKEN_COOKIE = "fk_customer_refresh_token";

export interface AuthCookieNames {
  access: string;
  refresh: string;
}

// Kept in sync with each surface's JWT signOptions and TokenService's refresh TTL.
const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // Secure requires HTTPS — off in local/CI dev (plain http://localhost),
    // on in production. Never disable this in production: an httpOnly-only
    // cookie without Secure can still leak over a plaintext connection.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function setAuthCookies(
  res: Response,
  names: AuthCookieNames,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(names.access, tokens.accessToken, cookieOptions(ACCESS_TOKEN_MAX_AGE_MS));
  res.cookie(names.refresh, tokens.refreshToken, cookieOptions(REFRESH_TOKEN_MAX_AGE_MS));
}

export function clearAuthCookies(res: Response, names: AuthCookieNames): void {
  res.clearCookie(names.access, { path: "/" });
  res.clearCookie(names.refresh, { path: "/" });
}
