import { IsEmail, IsString, Matches, MinLength } from "class-validator";

export class RegisterDto {
  @IsString()
  @MinLength(2)
  storeName!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{2,63}$/, {
    message: "storeSlug must be lowercase letters, numbers, and hyphens only",
  })
  storeSlug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
