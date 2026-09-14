import { IsString, MinLength } from "class-validator";

export class UpdateMeDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
