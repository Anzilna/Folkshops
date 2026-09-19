"use client";

import { Button, Input, Label } from "@folkshops/ui";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";

const RESEND_SECONDS = 30;

// UAE mobile numbers only — a landline (+971 4/2/3/6/7/9 ...) can't receive
// an SMS, so validating against the mobile-operator prefixes specifically
// (not a generic E.164 check) catches a typo'd landline number before it
// ever reaches the backend. 9 digits total: one of the six prefixes
// (50/52/54/55/56/58) + 7 more. Mirrors the backend's own (looser, E.164)
// check in RequestOtpDto/VerifyOtpDto — this is a UX improvement on top of
// that, not a replacement for server-side validation.
const UAE_MOBILE_REGEX = /^\+971(50|52|54|55|56|58)\d{7}$/;

/** Formats digits as the user types into "+971 5X XXX XXXX" — accepts a
 * leading "0" (local format, e.g. 0501234567) or "00971" (international
 * dialing prefix) and normalizes either into the same +971 form, so
 * pasting a number copied from a contact card still works. */
function formatUaePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00971")) digits = digits.slice(2);
  else if (digits.startsWith("0") && !digits.startsWith("971")) digits = `971${digits.slice(1)}`;
  else if (!digits.startsWith("971")) digits = `971${digits}`;
  digits = digits.slice(0, 12); // "971" + 9-digit subscriber number

  const national = digits.slice(3);
  let formatted = "+971";
  if (national.length > 0) formatted += ` ${national.slice(0, 2)}`;
  if (national.length > 2) formatted += ` ${national.slice(2, 5)}`;
  if (national.length > 5) formatted += ` ${national.slice(5, 9)}`;
  return formatted;
}

/**
 * Phone -> code, two steps in one component. The code is delivered by
 * core-api's OtpProvider — in dev that's ConsoleOtpProvider, so it prints
 * in the core-api log instead of arriving as an SMS.
 */
export function LoginForm() {
  const next = useSearchParams().get("next") ?? "/";
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+971");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const phoneDigits = phone.replace(/\D/g, "");
  const phoneValid = UAE_MOBILE_REGEX.test(phone.replace(/\s/g, ""));
  // Only surface the error once there are enough digits to be a real
  // attempt — otherwise every fresh page load with the bare "+971" prefix
  // (0 digits typed yet) would show a validation error before the person
  // has typed anything at all.
  const showPhoneError = phoneTouched && phoneDigits.length > 3 && !phoneValid;

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function readError(res: Response, fallback: string) {
    const body = await res.json().catch(() => null);
    return Array.isArray(body?.message) ? body.message.join(", ") : (body?.message ?? fallback);
  }

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setPhoneTouched(true);
    if (!phoneValid) return;
    setError(null);
    setBusy(true);
    try {
      const normalized = phone.replace(/[\s-]/g, "");
      const res = await apiFetch("/storefront/auth/otp/request", { method: "POST", body: JSON.stringify({ phone: normalized }) });
      if (!res.ok) throw new Error(await readError(res, res.status === 429 ? "Too many attempts — wait a minute." : "Couldn't send a code"));
      // devCode only exists outside production (see CustomerAuthService.requestOtp)
      // — there's no real SMS vendor chosen yet, so this is the fast path
      // instead of tailing core-api's log for every test login.
      const { devCode: code }: { devCode?: string } = await res.json().catch(() => ({}));
      if (code) {
        console.log(`[DEV OTP] code for ${normalized}: ${code}`);
        setDevCode(code);
      }
      setPhone(normalized);
      setStep("code");
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a code");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch("/storefront/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
      if (!res.ok) throw new Error(await readError(res, "That code didn't work"));
      // A full navigation, not router.push()+router.refresh() — found
      // live: right after OTP verify, the layout's own server-side
      // `cookieStore.has("fk_customer_access_token")` check (app/layout.tsx)
      // kept rendering as signed-out for a beat even though the cookie was
      // genuinely already set (confirmed by a hard reload immediately
      // showing signed-in correctly) — router.push() to "/" right after
      // this component's own fetch() apparently doesn't reliably re-fetch
      // the shared root layout's RSC data on this particular transition.
      // This is a one-time event (login), so the cost of a full page load
      // here is negligible next to guaranteeing a fresh server render.
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work");
      setBusy(false);
    }
  }

  if (step === "phone") {
    return (
      <form onSubmit={requestCode} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Mobile number</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(formatUaePhone(e.target.value))}
            onBlur={() => setPhoneTouched(true)}
            required
            autoFocus
            aria-invalid={showPhoneError}
            className={`h-11 text-base ${showPhoneError ? "border-destructive focus-visible:ring-destructive/40" : ""}`}
          />
          {showPhoneError ? (
            <p className="text-xs text-destructive">Enter a valid UAE mobile number, e.g. +971 50 123 4567.</p>
          ) : (
            <p className="text-xs text-muted-foreground">We&apos;ll text you a 6-digit code — UAE mobile numbers only.</p>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy || !phoneValid} className="h-11 rounded-full">
          {busy ? "Sending..." : "Send code"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">Code sent to {phone}</Label>
        <Input
          ref={codeRef}
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
          className="h-12 text-center text-2xl tracking-[0.4em]"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <button type="button" onClick={() => { setStep("phone"); setDevCode(null); }} className="underline underline-offset-4 hover:text-foreground">
            Change number
          </button>
          {resendIn > 0 ? (
            <span>Resend in {resendIn}s</span>
          ) : (
            <button type="button" onClick={() => requestCode()} className="underline underline-offset-4 hover:text-foreground">
              Resend code
            </button>
          )}
        </div>
        {devCode && (
          <p className="fk-fade-in rounded-lg bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
            Dev mode — no SMS sent. Your code: <span className="font-mono font-medium text-foreground">{devCode}</span>
          </p>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy || code.length !== 6} className="h-11 rounded-full">
        {busy ? "Checking..." : "Continue"}
      </Button>
    </form>
  );
}
