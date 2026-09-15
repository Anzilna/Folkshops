import { IsString, MinLength } from "class-validator";

// Sent as an Idempotency-Key-style header by the client convention
// (storefront's razorpay-checkout.tsx mints/reuses one per order via
// sessionStorage), but carried in the body here rather than a real HTTP
// header — simpler to validate with the existing global ValidationPipe,
// and this route has no other body fields that would make a header feel
// more natural.
export class PayOrderDto {
  @IsString()
  @MinLength(1)
  idempotencyKey!: string;
}
