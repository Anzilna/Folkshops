import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import type { PaymentProvider } from "../payment-provider.interface";
import { RazorpaySignatureGuard } from "./razorpay-signature.guard";

function makeContext(headers: Record<string, string>, rawBody?: Buffer): ExecutionContext {
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
    rawBody,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("RazorpaySignatureGuard", () => {
  function makeGuard(verifyResult: boolean) {
    const gateway = { verifyWebhookSignature: jest.fn().mockReturnValue(verifyResult) } as unknown as PaymentProvider;
    return { guard: new RazorpaySignatureGuard(gateway), gateway };
  }

  test("rejects when the signature header is missing", () => {
    const { guard } = makeGuard(true);
    const ctx = makeContext({}, Buffer.from("{}"));
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  test("rejects when the raw body wasn't captured", () => {
    const { guard } = makeGuard(true);
    const ctx = makeContext({ "x-razorpay-signature": "abc" }, undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  test("rejects an invalid signature", () => {
    const { guard, gateway } = makeGuard(false);
    const ctx = makeContext({ "x-razorpay-signature": "wrong" }, Buffer.from("{}"));
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(gateway.verifyWebhookSignature).toHaveBeenCalledWith({ rawBody: "{}", signature: "wrong" });
  });

  test("passes a valid signature", () => {
    const { guard } = makeGuard(true);
    const ctx = makeContext({ "x-razorpay-signature": "right" }, Buffer.from("{}"));
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
