CREATE TABLE "platform_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_label" text NOT NULL,
	"tenant_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "platform_audit_log_created_idx" ON "platform_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_log_tenant_idx" ON "platform_audit_log" USING btree ("tenant_id","created_at");