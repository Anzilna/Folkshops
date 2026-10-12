# @folkshops/whatsapp

Customer order updates on WhatsApp, through Meta's WhatsApp Cloud API called directly (no reseller). Only `apps/workers` sends. Every message is `console.log`ged, whether or not credentials are set. See `docs/decisions/0013-transactional-email.md` (WhatsApp section).

## Going live

1. In Meta Business Manager, create a WhatsApp Business Account, verify the business, and add a sender phone number.
2. In **WhatsApp Manager → Message templates**, create each template from `src/templates.ts`. Use the **same name**, the **Utility** category, and the language `en` (or whatever `WHATSAPP_TEMPLATE_LANGUAGE` is set to). Paste `body` in word for word, since the `{{n}}` placeholders must line up. Meta's approval is usually quick but can take up to a day.
3. Set `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` in `apps/workers/.env`. Use a permanent System User token, not the 24-hour test token.

| Template | Sent when | Body |
| --- | --- | --- |
| `order_confirmed` | `order.paid` | Hi {{1}}, thanks for shopping at {{2}}! Your order {{3}} is confirmed and paid. Total: {{4}}. View your order: {{5}} |
| `payment_not_completed` | `payment.failed` (order still unpaid) | Hi {{1}}, the payment for your order {{2}} at {{3}} didn't go through. Your order is saved — you can complete payment here: {{4}} |

Only customers with `customers.whatsapp_opt_in = true` are messaged. That flag is set only by the customer themselves, from the checkout checkbox or `/account`.
