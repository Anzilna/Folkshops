import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
