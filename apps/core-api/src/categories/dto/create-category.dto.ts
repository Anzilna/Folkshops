import { IsOptional, IsString, Matches, MinLength } from "class-validator";

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{1,200}$/, {
    message: "slug must be lowercase letters, numbers, and hyphens only",
  })
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
