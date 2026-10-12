import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-foreground">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {/* useSearchParams() (the token) needs a Suspense boundary for next build. */}
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
