import { IsInt, Min } from "class-validator";

// Sets the item's quantity to an absolute value — use DELETE to remove an
// item entirely rather than PATCHing quantity to 0.
export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}
