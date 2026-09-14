import { IsInt, IsUUID, Min } from "class-validator";
import { IsActiveField } from "../../common/dto/is-active.decorator";

// Explicit create (POST /inventory) — distinct from the PATCH upsert
// convenience the merchant-admin inventory list uses for "set a quantity
// for a product that has none yet". This is for the real CRUD "add an
// inventory record" flow (a picker outside the list, or a future API
// caller) and errors instead of silently updating if one already exists —
// see InventoryService.create().
export class CreateInventoryDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(0)
  quantity!: number;

  @IsActiveField()
  isActive?: boolean;
}
