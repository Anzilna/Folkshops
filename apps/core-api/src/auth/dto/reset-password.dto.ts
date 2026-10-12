import { IsString, Length, MinLength } from "class-validator";

export class ResetPasswordDto {
  // 32 random bytes, hex-encoded — see handlers/password-reset-requested.ts in apps/workers.
  @IsString()
  @Length(64, 64)
  token!: string;

  // Same minimum as RegisterDto.password.
  @IsString()
  @MinLength(8)
  password!: string;
}
