-- UI walkthroughs (guided tours). Definitions live in code
-- (apps/web/src/lib/walkthroughs/registry.ts); these tables hold per-tenant
-- role/auto-start config overrides and per-user completion so auto-start tours
-- never replay.

CREATE TABLE IF NOT EXISTS "walkthrough_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "walkthrough_id" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "auto_start" boolean DEFAULT false NOT NULL,
  "role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "walkthrough_settings_uniq" ON "walkthrough_settings" ("tenant_id","walkthrough_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "walkthrough_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "walkthrough_id" text NOT NULL,
  "status" text NOT NULL,
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "walkthrough_progress_uniq" ON "walkthrough_progress" ("tenant_id","user_id","walkthrough_id");
