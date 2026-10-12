import { Column, Row, Section, Text } from "react-email";
import { EmailLayout } from "../components/email-layout";
import { EmailHeading, EmailText, PrimaryButton } from "../components/primitives";
import { colors } from "../theme";

export interface WelcomeEmailProps {
  ownerName: string;
  storeName: string;
  dashboardUrl: string;
  storefrontUrl: string;
}

export const welcomeSubject = (props: WelcomeEmailProps) => `Welcome to Folkshops — ${props.storeName} is ready`;

/** Mirrors the merchant-admin dashboard's own onboarding checklist, so the email and the first screen they land on agree. */
const STEPS = [
  { title: "Add your first product", body: "Photos, price, and a description — it's live the moment you set it to Active." },
  { title: "Connect payments", body: "Link your Stripe account under Settings → Payments so shoppers can check out." },
  { title: "Share your store", body: "Your storefront is already online. Send the link to your first customers." },
];

export default function WelcomeEmail(props: WelcomeEmailProps) {
  const firstName = props.ownerName.split(" ")[0] || props.ownerName;
  return (
    <EmailLayout
      preview={`${props.storeName} is set up. Here's how to make your first sale.`}
      footerNote={`You're receiving this because you created ${props.storeName} on Folkshops.`}
    >
      <EmailHeading>Welcome, {firstName}</EmailHeading>
      <EmailText>
        <strong>{props.storeName}</strong> is set up and ready. Three steps stand between you and your first sale:
      </EmailText>

      <Section style={{ margin: "8px 0 24px" }}>
        {STEPS.map((step, i) => (
          <Row key={step.title} style={{ marginBottom: 14 }}>
            <Column style={{ width: 36, verticalAlign: "top" }}>
              <Text
                style={{
                  width: 24,
                  height: 24,
                  lineHeight: "24px",
                  borderRadius: 12,
                  backgroundColor: colors.canvas,
                  border: `1px solid ${colors.border}`,
                  color: colors.foreground,
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: "center",
                  margin: 0,
                }}
              >
                {i + 1}
              </Text>
            </Column>
            <Column style={{ verticalAlign: "top" }}>
              <Text style={{ fontSize: 15, fontWeight: 600, color: colors.foreground, margin: "2px 0 2px" }}>{step.title}</Text>
              <Text style={{ fontSize: 14, lineHeight: "21px", color: colors.mutedForeground, margin: 0 }}>{step.body}</Text>
            </Column>
          </Row>
        ))}
      </Section>

      <PrimaryButton href={props.dashboardUrl}>Open your dashboard</PrimaryButton>

      <Text style={{ fontSize: 13, lineHeight: "20px", color: colors.mutedForeground, margin: "24px 0 0" }}>
        Your storefront:{" "}
        <a href={props.storefrontUrl} style={{ color: colors.foreground }}>
          {props.storefrontUrl.replace(/^https?:\/\//, "")}
        </a>
      </Text>
    </EmailLayout>
  );
}

WelcomeEmail.PreviewProps = {
  ownerName: "Layla Haddad",
  storeName: "Desert Bloom",
  dashboardUrl: "http://localhost:3001",
  storefrontUrl: "http://desert-bloom.localhost:3000",
} satisfies WelcomeEmailProps;
