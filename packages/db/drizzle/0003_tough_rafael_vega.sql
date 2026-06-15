CREATE TABLE "inspection_type_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"group_id" uuid,
	"sequence" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"response_type" "inspection_bank_response_type" DEFAULT 'pass_fail_na' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"source_bank_id" uuid,
	"source_bank_criterion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_type_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Backfill: each existing type↔bank link becomes a group on the type (reusing
-- the link id as the group id), and that bank's criteria are copied in as
-- type-owned criteria. Must run BEFORE inspection_type_banks is dropped.
INSERT INTO "inspection_type_groups" ("id", "tenant_id", "type_id", "sequence", "label")
SELECT tb."id", tb."tenant_id", tb."type_id", tb."sequence", b."name"
FROM "inspection_type_banks" tb
JOIN "inspection_banks" b ON b."id" = tb."bank_id";--> statement-breakpoint
INSERT INTO "inspection_type_criteria"
	("tenant_id", "type_id", "group_id", "sequence", "text", "response_type", "requires_photo", "requires_comment", "source_bank_id", "source_bank_criterion_id")
SELECT tb."tenant_id", tb."type_id", tb."id", bc."sequence", bc."text", bc."response_type", bc."requires_photo", bc."requires_comment", bc."bank_id", bc."id"
FROM "inspection_type_banks" tb
JOIN "inspection_bank_criteria" bc ON bc."bank_id" = tb."bank_id";--> statement-breakpoint
ALTER TABLE "inspection_type_banks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "inspection_type_banks" CASCADE;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" DROP CONSTRAINT "inspection_record_criteria_criterion_id_inspection_bank_criteria_id_fk";
--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD COLUMN "group_label_snapshot" text;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD COLUMN "response_type" "inspection_bank_response_type" DEFAULT 'pass_fail_na' NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD COLUMN "requires_photo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" ADD COLUMN "requires_comment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill snapshot columns on existing record criteria from their source bank
-- criterion (where the legacy criterion_id still resolves). The bank name stands
-- in as the historical group label.
UPDATE "inspection_record_criteria" rc
SET
	"response_type" = bc."response_type",
	"requires_photo" = bc."requires_photo",
	"requires_comment" = bc."requires_comment",
	"group_label_snapshot" = b."name"
FROM "inspection_bank_criteria" bc
JOIN "inspection_banks" b ON b."id" = bc."bank_id"
WHERE rc."criterion_id" = bc."id";--> statement-breakpoint
ALTER TABLE "inspection_type_criteria" ADD CONSTRAINT "inspection_type_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria" ADD CONSTRAINT "inspection_type_criteria_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria" ADD CONSTRAINT "inspection_type_criteria_group_id_inspection_type_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."inspection_type_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_groups" ADD CONSTRAINT "inspection_type_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_groups" ADD CONSTRAINT "inspection_type_groups_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_type_criteria_tenant_idx" ON "inspection_type_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_type_criteria_type_group_seq_idx" ON "inspection_type_criteria" USING btree ("type_id","group_id","sequence");--> statement-breakpoint
CREATE INDEX "inspection_type_groups_tenant_idx" ON "inspection_type_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inspection_type_groups_type_seq_idx" ON "inspection_type_groups" USING btree ("type_id","sequence");