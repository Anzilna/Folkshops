import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // fk_access_token is httpOnly — StaffJwtGuard reads it via req.cookies,
  // same as core-api's own JwtAuthGuard.
  app.use(cookieParser());

  // This service is never meant to be hit directly by a browser — only
  // merchant-admin's own server (via its same-origin rewrite proxy) calls
  // it, forwarding the same cookies. CORS is still configured (not
  // disabled) so a direct dev-tools request against :4100 fails loudly
  // with a clear CORS error rather than silently "working" in a way
  // production's real network topology wouldn't allow.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });

  const port = process.env.PORT ? Number(process.env.PORT) : 4100;
  await app.listen(port);
  console.log(`analytics listening on http://localhost:${port}`);
}

bootstrap();
