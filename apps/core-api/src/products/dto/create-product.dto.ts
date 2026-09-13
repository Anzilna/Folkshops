import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, MinLength } from "class-validator";

export class CreateProductDto {
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

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Smallest currency unit (paise for INR) — see schema/products.ts. */
  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsIn(["draft", "active", "archived"])
  status?: "draft" | "active" | "archived";
}
