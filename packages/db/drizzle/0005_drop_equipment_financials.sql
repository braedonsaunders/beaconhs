-- Equipment financials moved to the NetSuite-connected admin app. Drop the rate
-- and expense ledgers and the purchase-price / billing-rate-category columns off
-- the operational equipment_items row. Idempotent (IF EXISTS): existing DBs are
-- push-managed and apply these via `db:push`; this file rebuilds fresh DBs cleanly.
-- The report_equipment_fleet / report_equipment_charges views that referenced
-- these tables are dropped + (for fleet) rebuilt by REPORT_VIEWS_SQL in migrate.ts.
DROP TABLE IF EXISTS "equipment_expenses" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "equipment_rates" CASCADE;--> statement-breakpoint
ALTER TABLE "equipment_items" DROP COLUMN IF EXISTS "purchase_price";--> statement-breakpoint
ALTER TABLE "equipment_items" DROP COLUMN IF EXISTS "billing_rate_category";
