import { Button } from "@folkshops/ui";
import Link from "next/link";
import type { AiEntitlement } from "../../lib/ai-api";

/**
 * What a store sees instead of the Store Copilot / knowledge base when its
 * plan doesn't include AI. Copy follows ai-service's entitlement reason, so
 * "upgrade" and "finish paying" aren't confused. Display only — ai-service
 * enforces the same rule on every request.
 */
export function AiUpgradeNotice({
  entitlement,
  compact = false,
}: {
  entitlement: AiEntitlement | { unavailable: true };
  compact?: boolean;
}) {
  let title: string;
  let body: string;
  let cta: string | null = "View plans";

  if ("unavailable" in entitlement) {
    title = "AI features are unavailable right now";
    body = "We couldn't reach the AI service. Try again in a few minutes.";
    cta = null;
  } else if (entitlement.reason === "subscription_inactive") {
    title = "Your subscription isn't active";
    body = `Your ${entitlement.plan_name ?? ""} plan includes AI features, but its payment hasn't gone through. Complete billing to turn them on.`;
    cta = "Go to billing";
  } else {
    title = "Upgrade to use AI features";
    body = `Your ${entitlement.plan_name ?? "current"} plan doesn't include the Store Copilot or knowledge base. Upgrade to answer questions from your own policies, FAQs and guides.`;
  }

  return (
    <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
      <div className="flex flex-col gap-1">
        <p className={`font-medium ${compact ? "text-sm" : "text-base"}`}>{title}</p>
        <p className={`text-muted-foreground ${compact ? "text-xs leading-relaxed" : "text-sm"}`}>{body}</p>
      </div>
      {cta && (
        <Link href="/settings/billing" className="w-fit">
          <Button variant="primary" size="sm">
            {cta}
          </Button>
        </Link>
      )}
    </div>
  );
}
