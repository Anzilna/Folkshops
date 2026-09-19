import { Card } from "@folkshops/ui";
import Link from "next/link";
import { ComingSoon } from "../coming-soon";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Payments</h2>
          <p className="text-xs text-muted-foreground">Connect Stripe so customers can pay you directly.</p>
        </div>
        <Link href="/settings/payments" className="text-sm font-medium text-accent underline underline-offset-4">
          Set up &rarr;
        </Link>
      </Card>
      <ComingSoon
        title="Everything else"
        description="Store profile and team invitations aren't built yet — staff invitations are explicitly deferred for now."
      />
    </div>
  );
}
