import { IsInt, IsOptional, Min } from "class-validator";
import { IsActiveField } from "../../common/dto/is-active.decorator";

// Both fields optional — a caller can adjust quantity, flip isActive, or
// both in one PATCH. Requires an existing (non-deleted) row; see
// InventoryService.update() vs. .create().
export class UpdateInventoryDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsActiveField()
  isActive?: boolean;
}
