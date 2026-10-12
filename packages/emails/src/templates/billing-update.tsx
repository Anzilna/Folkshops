import { Text } from "react-email";
import { EmailLayout } from "../components/email-layout";
import { EmailHeading, EmailText, PrimaryButton } from "../components/primitives";
import { colors, formatMoney } from "../theme";

export type BillingUpdateKind = "activated" | "past_due" | "canceled";

export interface BillingUpdateEmailProps {
  kind: BillingUpdateKind;
  storeName: string;
  planName: string;
  priceCents: number;
  currency: string;
  billingUrl: string;
}

/**
 * One template, three states of the same subscription — they share every
 * piece of layout and differ only in copy, so a lookup table beats three
 * near-identical files.
 */
const COPY: Record<BillingUpdateKind, { label: string; labelColor: string; subject: (p: BillingUpdateEmailProps) => string; heading: string; body: (p: BillingUpdateEmailProps) => string; cta: string }> = {
  activated: {
    label: "Active",
    labelColor: colors.success,
    subject: (p) => `You're on the ${p.planName} plan`,
    heading: "Your subscription is active",
    body: (p) => `${p.storeName} is now on the ${p.planName} plan at ${formatMoney(p.priceCents, p.currency)}/month.`,
    cta: "View billing",
  },
  past_due: {
    label: "Payment failed",
    labelColor: "#dc2626",
    subject: (p) => `Action needed: payment for ${p.storeName} failed`,
    heading: "We couldn't charge your card",
    body: (p) => `The latest payment for ${p.storeName}'s ${p.planName} plan didn't go through. Updating your payment method now keeps your plan running without interruption.`,
    cta: "Update payment method",
  },
  canceled: {
    label: "Canceled",
    labelColor: colors.mutedForeground,
    subject: (p) => `${p.storeName}'s subscription has been canceled`,
    heading: "Your subscription was canceled",
    body: (p) => `${p.storeName}'s ${p.planName} plan has ended. You can choose a plan again at any time from Billing.`,
    cta: "Choose a plan",
  },
};

export const billingUpdateSubject = (props: BillingUpdateEmailProps) => COPY[props.kind].subject(props);

export default function BillingUpdateEmail(props: BillingUpdateEmailProps) {
  const copy = COPY[props.kind];
  return (
    <EmailLayout preview={copy.body(props)} footerNote={`You're receiving this because you own ${props.storeName} on Folkshops.`}>
      <Text style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: copy.labelColor, margin: "0 0 8px" }}>
        {copy.label}
      </Text>
      <EmailHeading>{copy.heading}</EmailHeading>
      <EmailText>{copy.body(props)}</EmailText>
      <PrimaryButton href={props.billingUrl}>{copy.cta}</PrimaryButton>
    </EmailLayout>
  );
}

BillingUpdateEmail.PreviewProps = {
  kind: "past_due",
  storeName: "Desert Bloom",
  planName: "Grow",
  priceCents: 29900,
  currency: "aed",
  billingUrl: "http://localhost:3001/settings/billing",
} satisfies BillingUpdateEmailProps;
