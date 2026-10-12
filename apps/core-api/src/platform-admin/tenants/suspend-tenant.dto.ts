import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

export class SuspendTenantDto {
  /** Internal note for the next platform admin — never shown to the merchant. Required: "why" is the whole point of the audit trail. */
  // Trimmed BEFORE validation, so a reason of three spaces is rejected.
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
