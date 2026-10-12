import { render } from "react-email";
import BillingUpdateEmail, { billingUpdateSubject, type BillingUpdateEmailProps } from "./templates/billing-update";
import NewOrderEmail, { newOrderSubject, type NewOrderEmailProps } from "./templates/new-order";
import PasswordResetEmail, { passwordResetSubject, type PasswordResetEmailProps } from "./templates/password-reset";
import PaymentsLiveEmail, { paymentsLiveSubject, type PaymentsLiveEmailProps } from "./templates/payments-live";
import WelcomeEmail, { welcomeSubject, type WelcomeEmailProps } from "./templates/welcome";

/**
 * The one place that knows every template. A job only ever carries a
 * template *name* plus its props (plain JSON, so it survives a trip through
 * BullMQ/Redis), and this map turns that back into a React element — adding
 * a template is a new file in templates/ plus one entry here.
 */
export interface EmailTemplateProps {
  welcome: WelcomeEmailProps;
  "new-order": NewOrderEmailProps;
  "password-reset": PasswordResetEmailProps;
  "billing-update": BillingUpdateEmailProps;
  "payments-live": PaymentsLiveEmailProps;
}

export type EmailTemplateName = keyof EmailTemplateProps;

const TEMPLATES: { [K in EmailTemplateName]: { component: (props: EmailTemplateProps[K]) => React.ReactNode; subject: (props: EmailTemplateProps[K]) => string } } = {
  welcome: { component: WelcomeEmail, subject: welcomeSubject },
  "new-order": { component: NewOrderEmail, subject: newOrderSubject },
  "password-reset": { component: PasswordResetEmail, subject: passwordResetSubject },
  "billing-update": { component: BillingUpdateEmail, subject: billingUpdateSubject },
  "payments-live": { component: PaymentsLiveEmail, subject: paymentsLiveSubject },
};

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Always sent alongside html — some clients/filters score html-only mail as spam. */
  text: string;
}

export async function renderEmail<K extends EmailTemplateName>(name: K, props: EmailTemplateProps[K]): Promise<RenderedEmail> {
  const template = TEMPLATES[name];
  if (!template) throw new Error(`Unknown email template "${String(name)}"`);
  const element = template.component(props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: template.subject(props), html, text };
}
