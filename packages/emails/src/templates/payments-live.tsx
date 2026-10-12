import { EmailLayout } from "../components/email-layout";
import { EmailHeading, EmailText, PrimaryButton } from "../components/primitives";

export interface PaymentsLiveEmailProps {
  storeName: string;
  storefrontUrl: string;
  dashboardUrl: string;
}

export const paymentsLiveSubject = (props: PaymentsLiveEmailProps) => `${props.storeName} can now accept payments`;

export default function PaymentsLiveEmail(props: PaymentsLiveEmailProps) {
  return (
    <EmailLayout
      preview="Stripe finished reviewing your account — checkout is open."
      footerNote={`You're receiving this because you own ${props.storeName} on Folkshops.`}
    >
      <EmailHeading>You&apos;re ready to get paid</EmailHeading>
      <EmailText>
        Stripe has finished reviewing your account, so shoppers on <strong>{props.storeName}</strong> can now check out and pay. Payouts go to
        the bank account on your Stripe account.
      </EmailText>
      <EmailText muted>
        Your store: <a href={props.storefrontUrl}>{props.storefrontUrl.replace(/^https?:\/\//, "")}</a>
      </EmailText>
      <PrimaryButton href={props.dashboardUrl}>Go to your dashboard</PrimaryButton>
    </EmailLayout>
  );
}

PaymentsLiveEmail.PreviewProps = {
  storeName: "Desert Bloom",
  storefrontUrl: "http://desert-bloom.localhost:3000",
  dashboardUrl: "http://localhost:3001",
} satisfies PaymentsLiveEmailProps;
