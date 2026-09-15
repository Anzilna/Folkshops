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
  // Needed because Razorpay's webhook signature is computed over the
  // exact raw bytes it sent, which is not always byte-identical to
  // JSON.stringify(JSON.parse(rawBody)) — see RazorpaySignatureGuard.
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
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  console.log(`core-api listening on http://localhost:${port}`);
}

bootstrap();
