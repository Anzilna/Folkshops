CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"linked_account_id" text,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"legal_business_name" text NOT NULL,
	"business_type" text NOT NULL,
	"contact_name" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text NOT NULL,
	"pan" text,
	"gst" text,
	"registered_address" jsonb NOT NULL,
	"status" text,
	"live" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_unique" ON "payment_accounts" USING btree ("tenant_id");