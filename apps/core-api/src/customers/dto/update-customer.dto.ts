import { IsOptional, IsString, MinLength } from "class-validator";

// phone is intentionally not editable here — it's the customer's login
// identity (OTP goes to it); changing it is a re-verification flow this
// codebase doesn't have, not a plain field edit.
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
