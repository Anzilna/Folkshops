import { Column, Hr, Row, Section, Text } from "react-email";
import { EmailLayout } from "../components/email-layout";
import { EmailHeading, EmailText, PrimaryButton } from "../components/primitives";
import { colors, formatMoney } from "../theme";

export interface NewOrderEmailProps {
  storeName: string;
  /** Short display number — same `#` + first 8 chars of the uuid the notification bell uses. */
  orderNumber: string;
  orderUrl: string;
  customerName: string | null;
  currency: string;
  subtotalCents: number;
  items: { productName: string; quantity: number; priceCents: number }[];
}

export const newOrderSubject = (props: NewOrderEmailProps) =>
  `New order ${props.orderNumber} — ${formatMoney(props.subtotalCents, props.currency)}`;

export default function NewOrderEmail(props: NewOrderEmailProps) {
  const total = formatMoney(props.subtotalCents, props.currency);
  const itemCount = props.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <EmailLayout
      preview={`${props.customerName ?? "A customer"} paid ${total} for ${itemCount} ${itemCount === 1 ? "item" : "items"}.`}
      footerNote={`You're receiving this because you're a member of ${props.storeName} on Folkshops.`}
    >
      <Text style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: colors.success, margin: "0 0 8px" }}>
        Paid
      </Text>
      <EmailHeading>New order {props.orderNumber}</EmailHeading>
      <EmailText muted>
        {props.customerName ?? "A customer"} just placed an order on {props.storeName}.
      </EmailText>

      <Section style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: "4px 16px", margin: "8px 0 24px" }}>
        {props.items.map((item, i) => (
          <Row key={`${item.productName}-${i}`} style={{ borderTop: i === 0 ? "none" : `1px solid ${colors.border}` }}>
            <Column style={{ padding: "12px 0" }}>
              <Text style={{ fontSize: 14, color: colors.foreground, margin: 0 }}>{item.productName}</Text>
              <Text style={{ fontSize: 13, color: colors.mutedForeground, margin: "2px 0 0" }}>
                {item.quantity} × {formatMoney(item.priceCents, props.currency)}
              </Text>
            </Column>
            <Column style={{ padding: "12px 0", textAlign: "right", verticalAlign: "top" }}>
              <Text style={{ fontSize: 14, color: colors.foreground, margin: 0 }}>
                {formatMoney(item.priceCents * item.quantity, props.currency)}
              </Text>
            </Column>
          </Row>
        ))}
        <Hr style={{ borderColor: colors.border, margin: 0 }} />
        <Row>
          <Column style={{ padding: "12px 0" }}>
            <Text style={{ fontSize: 14, fontWeight: 600, color: colors.foreground, margin: 0 }}>Total</Text>
          </Column>
          <Column style={{ padding: "12px 0", textAlign: "right" }}>
            <Text style={{ fontSize: 14, fontWeight: 600, color: colors.foreground, margin: 0 }}>{total}</Text>
          </Column>
        </Row>
      </Section>

      <PrimaryButton href={props.orderUrl}>View order</PrimaryButton>
    </EmailLayout>
  );
}

NewOrderEmail.PreviewProps = {
  storeName: "Desert Bloom",
  orderNumber: "#3F9A1C2B",
  orderUrl: "http://localhost:3001/orders/3f9a1c2b",
  customerName: "Omar Saeed",
  currency: "aed",
  subtotalCents: 48500,
  items: [
    { productName: "Oud Candle — Large", quantity: 2, priceCents: 14500 },
    { productName: "Hand-thrown Ceramic Mug", quantity: 1, priceCents: 9500 },
    { productName: "Linen Table Runner", quantity: 1, priceCents: 10000 },
  ],
} satisfies NewOrderEmailProps;
