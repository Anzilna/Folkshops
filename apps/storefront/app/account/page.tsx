import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverFetch } from "../../lib/api";
import { AccountForm } from "./account-form";

interface MeResponse {
  customer: { sub: string; phone: string; name?: string | null };
}

export default async function AccountPage() {
  const cookieHeader = (await cookies()).toString();
  const res = await serverFetch("/storefront/auth/me", cookieHeader);
  if (res.status === 401) redirect("/login?next=/account");
  const { customer }: MeResponse = await res.json();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8">
      <h1 className="sf-display text-3xl font-semibold">Your account</h1>

      <div className="rounded-2xl border border-border p-6">
        <AccountForm initialName={customer.name ?? null} phone={customer.phone} />
      </div>

      <div className="flex flex-col gap-1 rounded-2xl border border-border p-6">
        <h2 className="text-sm font-medium">Order history</h2>
        <p className="text-sm text-muted-foreground">Everything you&apos;ve ordered from this store.</p>
        <Link href="/orders" className="mt-2 text-sm font-medium underline underline-offset-4">
          View orders &rarr;
        </Link>
      </div>
    </div>
  );
}
