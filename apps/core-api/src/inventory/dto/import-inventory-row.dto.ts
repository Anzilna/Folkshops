import { IsInt, IsUUID, Min } from "class-validator";

// A bulk-import row identifies the product by id (exported CSVs include
// it) and sets its quantity — same shape UpdateInventoryDto would have if
// it also carried the product id.
export class ImportInventoryRowDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(0)
  quantity!: number;
}
