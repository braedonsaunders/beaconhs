-- Harden the person <-> login-account link (people.user_id -> user.id).
--
-- 1. Reverse-lookup index: the "user -> person" direction (compliance audience,
--    notification recipients, flows delivery) joins people by user_id and had
--    no supporting index.
-- 2. Partial unique index enforcing the 1:1 rule a login account maps to AT
--    MOST one active person per tenant. Every `people.user_id = <session user>`
--    lookup does .limit(1) assuming this; nothing enforced it. Partial so the
--    many login-less workers (null user_id) and soft-deleted rows never collide.

CREATE INDEX IF NOT EXISTS "people_user_idx" ON "people" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_tenant_user_ux" ON "people" ("tenant_id", "user_id")
  WHERE "user_id" is not null and "deleted_at" is null;
