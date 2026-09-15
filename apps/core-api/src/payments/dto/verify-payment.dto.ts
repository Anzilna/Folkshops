import { IsString, MinLength } from "class-validator";

// Exactly the three fields Razorpay Checkout.js's client-side `handler`
// callback hands back after a payment attempt — see razorpay-checkout.tsx.
// idempotencyKey must match the one used on the preceding /pay call (the
// same payments row that call created/found is the one this verifies).
export class VerifyPaymentDto {
  @IsString()
  @MinLength(1)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  razorpayOrderId!: string;

  @IsString()
  @MinLength(1)
  razorpayPaymentId!: string;

  @IsString()
  @MinLength(1)
  razorpaySignature!: string;
}
