import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

// bcrypt only uses the first 72 bytes of a password; beyond that, two
// different passwords would silently hash the same. Same ceiling for every
// platform-admin password, so it is rejected instead of truncated.
const PASSWORD_MAX = 72;

export class QueryPlatformAdminsDto extends PaginationQueryDto {}

export class CreatePlatformAdminDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}
