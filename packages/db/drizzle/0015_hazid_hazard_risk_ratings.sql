-- Pre/post-control risk ratings on hazid_assessment_hazards.
--
-- A real safety risk assessment shows that the controls actually reduce risk:
-- you rate likelihood + severity BEFORE controls are applied (inherent risk),
-- then again AFTER (residual risk). The score itself is computed in app code
-- as likelihood × severity, so no GENERATED column is needed.
--
-- The `controls` column captures the free-text description of the mitigations
-- being applied between the pre and post rating. It is distinct from
-- `standard_controls` (the library-snapshotted boilerplate) and
-- `specific_controls` (site-specific overrides) — those remain for backward
-- compatibility.
--
-- Idempotent: re-running the migration is safe.

ALTER TABLE "hazid_assessment_hazards"
  ADD COLUMN IF NOT EXISTS "pre_likelihood" integer;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards"
  ADD COLUMN IF NOT EXISTS "pre_severity" integer;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards"
  ADD COLUMN IF NOT EXISTS "controls" text;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards"
  ADD COLUMN IF NOT EXISTS "post_likelihood" integer;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards"
  ADD COLUMN IF NOT EXISTS "post_severity" integer;
