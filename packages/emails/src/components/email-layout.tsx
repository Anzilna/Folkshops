import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "react-email";
import { colors, fontFamily } from "../theme";

interface EmailLayoutProps {
  /** Inbox preview line shown next to the subject — never shown in the body itself. */
  preview: string;
  children: ReactNode;
  /** Why this person got this email — every transactional email should say so. */
  footerNote: string;
}

/**
 * Shared shell for every Folkshops email: wordmark, a single white card on
 * a muted canvas, and a footer. Table-based layout comes from react-email's
 * own primitives (Container/Section render as <table>), which is what keeps
 * this rendering the same in Outlook as it does in Gmail/Apple Mail.
 */
export function EmailLayout({ preview, children, footerNote }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.canvas, fontFamily, margin: 0, padding: "32px 0" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: "0 16px" }}>
          <Text style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: colors.foreground, margin: "0 0 20px" }}>
            Folkshops
          </Text>
          <Section
            style={{
              backgroundColor: colors.background,
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              padding: "32px 32px 28px",
            }}
          >
            {children}
          </Section>
          <Hr style={{ borderColor: colors.border, margin: "28px 0 16px" }} />
          <Text style={{ fontSize: 12, lineHeight: "18px", color: colors.mutedForeground, margin: 0 }}>{footerNote}</Text>
          <Text style={{ fontSize: 12, lineHeight: "18px", color: colors.mutedForeground, margin: "8px 0 0" }}>
            Sent by{" "}
            <Link href="https://folkshops.com" style={{ color: colors.mutedForeground, textDecoration: "underline" }}>
              Folkshops
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
