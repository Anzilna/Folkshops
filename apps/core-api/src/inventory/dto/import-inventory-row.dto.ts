import { IsInt, IsUUID, Min } from "class-validator";
import { IsActiveField } from "../../common/dto/is-active.decorator";

// A bulk-import row identifies the product by id (exported CSVs include
// it) and sets its quantity/isActive — same shape UpdateInventoryDto would
// have if it also carried the product id. isActive optional (defaults to
// true in upsert()) so older exports without the column still import.
export class ImportInventoryRowDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(0)
  quantity!: number;

  @IsActiveField()
  isActive?: boolean;
}
