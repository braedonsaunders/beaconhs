CREATE TYPE "public"."document_reference_kind" AS ENUM('url', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."kiosk_scan_kind" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TABLE "document_book_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"kind" "document_reference_kind" NOT NULL,
	"url" text,
	"attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kiosk_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "kiosk_scan_kind" NOT NULL,
	"site_org_unit_id" uuid,
	"crew_id" uuid,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "kiosk_pin" text;--> statement-breakpoint
ALTER TABLE "document_book_items" ADD CONSTRAINT "document_book_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_book_items" ADD CONSTRAINT "document_book_items_book_id_document_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."document_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_book_items" ADD CONSTRAINT "document_book_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_scans" ADD CONSTRAINT "kiosk_scans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_scans" ADD CONSTRAINT "kiosk_scans_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_scans" ADD CONSTRAINT "kiosk_scans_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_scans" ADD CONSTRAINT "kiosk_scans_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_book_items_book_idx" ON "document_book_items" USING btree ("book_id","position");--> statement-breakpoint
CREATE INDEX "document_book_items_tenant_idx" ON "document_book_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_book_items_book_doc_ux" ON "document_book_items" USING btree ("book_id","document_id");--> statement-breakpoint
CREATE INDEX "document_references_tenant_idx" ON "document_references" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_references_category_idx" ON "document_references" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "kiosk_scans_tenant_idx" ON "kiosk_scans" USING btree ("tenant_id","scanned_at");--> statement-breakpoint
CREATE INDEX "kiosk_scans_person_idx" ON "kiosk_scans" USING btree ("tenant_id","person_id","scanned_at");