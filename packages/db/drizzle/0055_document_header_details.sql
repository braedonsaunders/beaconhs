ALTER TABLE documents ADD COLUMN IF NOT EXISTS header_issued_on date;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN IF NOT EXISTS header_revised_on date;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN IF NOT EXISTS header_approved_by text;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN IF NOT EXISTS header_version_label text;
