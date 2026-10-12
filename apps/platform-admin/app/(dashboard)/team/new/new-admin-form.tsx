"use client";

import { Button, Card, Field, Input } from "@folkshops/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAdmin } from "../../../../lib/platform-api";

export function NewAdminForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createAdmin({ name, email, password });
      router.push("/team");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add this admin");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-6">
      <Card className="flex flex-col gap-5">
        <Field label="Name" htmlFor="pa-name">
          <Input id="pa-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
        </Field>
        <Field label="Email" htmlFor="pa-email">
          <Input id="pa-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Temporary password" htmlFor="pa-password" hint="At least 8 characters. Share it with them privately — there's no invitation email.">
          <Input id="pa-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={72} required />
        </Field>
      </Card>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Link href="/team">
          <Button variant="outline" disabled={submitting}>
            Cancel
          </Button>
        </Link>
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? "Adding..." : "Add admin"}
        </Button>
      </div>
    </form>
  );
}
