import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true captures the raw request buffer (via body-parser's
  // `verify` hook) as req.rawBody on every route, alongside the normally
  // parsed req.body — nothing else about global JSON parsing changes.
  // Needed because Stripe's webhook signature is computed over the
  // exact raw bytes it sent, which is not always byte-identical to
  // JSON.stringify(JSON.parse(rawBody)) — see StripeSignatureGuard.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Auth cookies are httpOnly, so req.cookies (used by JwtAuthGuard and the
  // /auth/refresh, /auth/logout routes) needs this to be populated at all.
  app.use(cookieParser());

  // credentials: true is required for the browser to send/receive cookies
  // cross-origin (each frontend app is a different port/subdomain from
  // core-api) — without it, Set-Cookie on the response is silently
  // ignored by the browser regardless of what the cookie itself specifies.
  // Origin can't be "*" when credentials are involved, so it's an explicit
  // allowlist instead.
  //
  // A plain string in the allowlist is matched exactly (the `cors` package's
  // own documented behavior for a String entry) — that covers merchant-admin/
  // platform-admin/marketing, each a single fixed origin. The storefront is
  // different: it resolves tenants from the request's own subdomain
  // (nike.localhost:3000, demo.localhost:3000, ...), so its client-side
  // fetch() calls arrive from a different Origin per tenant — no fixed
  // string can list them all. An entry containing "*" is compiled to a
  // RegExp instead (the `cors` package accepts RegExp array entries too),
  // so CORS_ORIGINS can carry a pattern like "http://*.localhost:3000"
  // covering every tenant subdomain in dev, or "https://*.folkshops.com"
  // in production once real custom-subdomain storefronts exist.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) =>
      origin.includes("*")
        ? new RegExp(`^${origin.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+")}$`, "i")
        : origin,
    );
  app.enableCors({ origin: corsOrigins, credentials: true });

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  console.log(`core-api listening on http://localhost:${port}`);
}

bootstrap();
