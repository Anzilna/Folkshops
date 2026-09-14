import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="sf-display text-3xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">No password — just your phone number and a one-time code.</p>
      </div>
      {/* useSearchParams() inside needs a Suspense boundary for static rendering. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
