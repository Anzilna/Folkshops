import { IsIn, IsISO8601, IsOptional } from "class-validator";

export class DateRangeDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class SalesOverTimeDto extends DateRangeDto {
  @IsOptional()
  @IsIn(["day", "week", "month"])
  interval?: "day" | "week" | "month" = "day";
}
