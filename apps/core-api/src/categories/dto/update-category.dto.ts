import { IsOptional, IsString, Matches, MinLength } from "class-validator";

// Hand-written rather than PartialType(CreateCategoryDto) — same reasoning
// as products/dto/update-product.dto.ts.
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,200}$/, {
    message: "slug must be lowercase letters, numbers, and hyphens only",
  })
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
