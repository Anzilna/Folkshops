import { IsOptional, IsString, MinLength } from "class-validator";
import { IsActiveField } from "../../common/dto/is-active.decorator";

// Customers are normally created only by OTP verification (see
// customer-auth.service.ts) — no password, no self-service form. This DTO
// exists for the staff-side management path instead: a merchant manually
// adding a customer record, or bulk-importing an existing customer list
// migrated from another platform.
export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  phone!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsActiveField()
  isActive?: boolean;
}
