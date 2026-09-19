import { IsString, Matches, MinLength } from "class-validator";

// idempotencyKey is sent as an Idempotency-Key-style header by client
// convention (storefront's stripe-checkout-button.tsx mints/reuses one
// per order via sessionStorage), but carried in the body here rather than
// a real HTTP header — simpler to validate with the existing global
// ValidationPipe, and this route has no other body fields that would make
// a header feel more natural.
//
// returnUrl is the storefront's own order-page URL (e.g.
// "https://nike.folkshops.com/orders/<id>") — the backend can't build
// this itself since tenant hostnames are resolved per-request from
// whatever subdomain the storefront is actually running on (see
// storefront's resolveStoreSlug()), not a single fixed origin the way
// merchant-admin's Connect return_url is. PaymentsService appends
// ?paid=1/?canceled=1 to it for Stripe's success_url/cancel_url.
export class PayOrderDto {
  @IsString()
  @MinLength(1)
  idempotencyKey!: string;

  @IsString()
  @Matches(/^https?:\/\//, { message: "returnUrl must be an absolute http(s) URL" })
  returnUrl!: string;
}
