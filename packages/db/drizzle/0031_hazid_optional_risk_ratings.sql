-- Assessment types can turn the before/after risk-matrix ratings on hazard
-- rows off (legacy checklist flow: seeded hazards start as not applicable and
-- applicable hazards require typed site-specific controls instead of ratings).
ALTER TABLE "hazid_assessment_types" ADD COLUMN IF NOT EXISTS "has_risk_ratings" boolean DEFAULT true NOT NULL;
