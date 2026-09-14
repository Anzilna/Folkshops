import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, MinLength } from "class-validator";
import { IsActiveField } from "../../common/dto/is-active.decorator";

// Hand-written rather than `PartialType(CreateProductDto)` (@nestjs/mapped-types)
// to avoid adding a dependency for one small DTO.
export class UpdateProductDto {
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

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsIn(["draft", "active", "archived"])
  status?: "draft" | "active" | "archived";

  @IsActiveField()
  isActive?: boolean;
}
