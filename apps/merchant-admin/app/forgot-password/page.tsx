import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-foreground">
      <div className="flex w-full max-w-sm flex-col gap-1.5 text-center">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="text-sm text-muted-foreground">Enter the email you sign in with and we&apos;ll send you a link.</p>
      </div>
      <ForgotPasswordForm />
    </main>
  );
}
