import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";

/**
 * Optional isActive boolean — shared by every module with an isActive
 * column (products/categories/customers/inventory), used on both
 * Create/Update DTOs (the field itself) and Query DTOs (the `?isActive=`
 * filter) since the coercion problem is identical in both places.
 *
 * class-transformer's own `enableImplicitConversion` (used by
 * bulk-import.util.ts for CSV rows, where every cell arrives as a string)
 * does NOT correctly coerce booleans — it treats any non-empty string as
 * truthy via a plain `Boolean(value)`, so a CSV cell "false" becomes
 * `true`. Confirmed empirically before this shipped. Worse: that
 * coercion runs BEFORE a custom @Transform sees the value, so reading
 * `value` here would already be the wrongly-coerced boolean, not the
 * original string — confirmed empirically too (`value` was already
 * `true` for both "true" and "false" inputs). The fix has to read the
 * untouched source field via `obj[key]` instead of `value`, which
 * sidesteps whatever implicit coercion already ran. This also works fine
 * when there's no implicit conversion at all (the global ValidationPipe
 * doesn't enable it — see main.ts — so a real querystring/JSON value
 * reaches `obj[key]` unmodified either way).
 */
export function IsActiveField(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Transform(({ obj, key }) => {
      const raw = (obj as Record<string, unknown>)[key];
      return typeof raw === "string" ? raw.toLowerCase() === "true" : raw;
    }),
    IsBoolean(),
  );
}
