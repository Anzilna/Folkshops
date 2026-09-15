import { Type } from "class-transformer";
import { IsEmail, IsOptional, IsString, MinLength, ValidateNested } from "class-validator";

class RegisteredAddressDto {
  @IsString()
  @MinLength(1)
  street1!: string;

  @IsOptional()
  @IsString()
  street2?: string;

  @IsString()
  @MinLength(1)
  city!: string;

  @IsString()
  @MinLength(1)
  state!: string;

  @IsString()
  @MinLength(1)
  postalCode!: string;

  @IsString()
  @MinLength(2)
  country!: string;
}

// The KYC submission for a Route Linked Account — see
// PaymentProvider.CreateLinkedAccountInput / RazorpayProvider.createLinkedAccount()
// for exactly how each field maps to Razorpay's own API request.
export class CreatePaymentAccountDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  phone!: string;

  @IsString()
  @MinLength(4)
  legalBusinessName!: string;

  @IsString()
  @MinLength(1)
  businessType!: string;

  @IsString()
  @MinLength(1)
  contactName!: string;

  @IsString()
  @MinLength(1)
  category!: string;

  @IsString()
  @MinLength(1)
  subcategory!: string;

  @IsOptional()
  @IsString()
  pan?: string;

  @IsOptional()
  @IsString()
  gst?: string;

  @ValidateNested()
  @Type(() => RegisteredAddressDto)
  registeredAddress!: RegisteredAddressDto;
}
