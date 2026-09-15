CREATE TYPE "public"."payment_status" AS ENUM('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'awaiting_payment' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'paid' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'payment_failed' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'refunded';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'partially_refunded';--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"provider_order_id" text,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"event_type" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_order_lookup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_order_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_lookup" ADD CONSTRAINT "payment_order_lookup_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_lookup" ADD CONSTRAINT "payment_order_lookup_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_lookup" ADD CONSTRAINT "payment_order_lookup_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_idempotency_key_unique" ON "payments" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_id_unique" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_tenant_provider_event_unique" ON "payment_events" USING btree ("tenant_id","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_lookup_provider_order_id_unique" ON "payment_order_lookup" USING btree ("provider_order_id");