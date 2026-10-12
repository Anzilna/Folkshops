import { Text } from "react-email";
import { EmailLayout } from "../components/email-layout";
import { EmailHeading, EmailText, PrimaryButton } from "../components/primitives";
import { colors } from "../theme";

export interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export const passwordResetSubject = () => "Reset your Folkshops password";

export default function PasswordResetEmail(props: PasswordResetEmailProps) {
  const firstName = props.name.split(" ")[0] || props.name;
  return (
    <EmailLayout
      preview={`This link expires in ${props.expiresInMinutes} minutes.`}
      footerNote="You're receiving this because a password reset was requested for your Folkshops account."
    >
      <EmailHeading>Reset your password</EmailHeading>
      <EmailText>
        Hi {firstName}, we got a request to reset the password for your Folkshops account. Choose a new one below.
      </EmailText>
      <PrimaryButton href={props.resetUrl}>Choose a new password</PrimaryButton>
      <Text style={{ fontSize: 13, lineHeight: "20px", color: colors.mutedForeground, margin: "24px 0 0" }}>
        This link expires in {props.expiresInMinutes} minutes and works once. Resetting signs you out everywhere else.
        If you didn&apos;t ask for this, ignore this email — your password stays the same.
      </Text>
    </EmailLayout>
  );
}

PasswordResetEmail.PreviewProps = {
  name: "Layla Haddad",
  resetUrl: "http://localhost:3001/reset-password?token=0123456789abcdef",
  expiresInMinutes: 30,
} satisfies PasswordResetEmailProps;
