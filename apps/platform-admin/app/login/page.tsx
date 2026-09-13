import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="text-xl font-semibold">Folkshops Platform Admin</h1>
      <LoginForm />
    </main>
  );
}
