import { IsEmail, IsOptional, IsString, Matches, MinLength } from "class-validator";

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

  // Optional here (class-validator level) so AuthService.register() can
  // throw its own clearer "A plan must be selected" message — but it is
  // NOT optional in practice: register() rejects a missing planSlug
  // outright, no default. See that method's own comment.
  @IsOptional()
  @IsString()
  planSlug?: string;
}
