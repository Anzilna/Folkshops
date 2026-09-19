import { IsString, Length, Matches } from "class-validator";

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: "phone must be in E.164 format, e.g. +971501234567" })
  phone!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
