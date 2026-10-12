ALTER TABLE "customers" ADD COLUMN "whatsapp_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "whatsapp_opt_in_at" timestamp with time zone;