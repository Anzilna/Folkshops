import type { ReactNode } from "react";
import { Button, Heading, Text } from "react-email";
import { colors } from "../theme";

/** Small building blocks so templates share one type scale instead of each re-declaring inline styles. */

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Heading as="h1" style={{ fontSize: 22, lineHeight: "28px", fontWeight: 600, letterSpacing: "-0.01em", color: colors.foreground, margin: "0 0 12px" }}>
      {children}
    </Heading>
  );
}

export function EmailText({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <Text style={{ fontSize: 15, lineHeight: "24px", color: muted ? colors.mutedForeground : colors.foreground, margin: "0 0 16px" }}>
      {children}
    </Text>
  );
}

export function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      href={href}
      style={{
        backgroundColor: colors.accent,
        color: colors.accentForeground,
        fontSize: 14,
        fontWeight: 600,
        borderRadius: 8,
        padding: "12px 20px",
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {children}
    </Button>
  );
}
