-- Person ID badges: unguessable public token behind the printed badge QR
-- (opens /verify/person/<token>, the live training transcript). Generated
-- lazily on first badge print — nullable, globally unique when set.
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "badge_token" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_badge_token_ux" ON "people" ("badge_token") WHERE "badge_token" is not null;
