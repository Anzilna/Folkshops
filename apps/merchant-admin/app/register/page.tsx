import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-12 text-foreground">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold">Start selling on Folkshops</h1>
        <p className="text-sm text-muted-foreground">Your store is ready the moment you submit this.</p>
      </div>
      <RegisterForm />
    </main>
  );
}
