"use client";

import { Button, Input, Label } from "@folkshops/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";

const RESEND_SECONDS = 30;

/**
 * Phone -> code, two steps in one component. The code is delivered by
 * core-api's OtpProvider — in dev that's ConsoleOtpProvider, so it prints
 * in the core-api log instead of arriving as an SMS.
 */
export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+91");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

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
    setError(null);
    setBusy(true);
    try {
      const normalized = phone.replace(/[\s-]/g, "");
      const res = await apiFetch("/storefront/auth/otp/request", { method: "POST", body: JSON.stringify({ phone: normalized }) });
      if (!res.ok) throw new Error(await readError(res, res.status === 429 ? "Too many attempts — wait a minute." : "Couldn't send a code"));
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
      router.push(next);
      router.refresh();
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
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus className="h-11 text-base" />
          <p className="text-xs text-muted-foreground">We&apos;ll text you a 6-digit code. Include the country code.</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy} className="h-11 rounded-full">
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
          <button type="button" onClick={() => setStep("phone")} className="underline underline-offset-4 hover:text-foreground">
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
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy || code.length !== 6} className="h-11 rounded-full">
        {busy ? "Checking..." : "Continue"}
      </Button>
    </form>
  );
}
