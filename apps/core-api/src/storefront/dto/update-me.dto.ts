import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

/** Both optional — the account page saves name, checkout saves only the WhatsApp choice. */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  // JSON-only endpoint (no CSV import path), so a plain @IsBoolean() is
  // safe here — bug #19's coercion problem is specific to bulk-import.
  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;
}
