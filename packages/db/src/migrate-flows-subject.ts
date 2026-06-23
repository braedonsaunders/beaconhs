// One-off, idempotent migration for the UNIFIED FLOWS schema (form templates +
// native modules) and the email-template library. Applies ONLY these additions
// so it never touches unrelated drift on the push-managed dev DB:
//   • form_automations → polymorphic (subject_type/subject_key, templateId nullable)
//   • new flow_gates table (one gate store for every subject)
//   • new email_templates table (the send_email template library)
//
// Run BEFORE `db:migrate` (which restores the RLS policies these new tables need
// and which db:push --force would otherwise drop):
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/migrate-flows-subject.ts
//   pnpm --filter @beaconhs/db migrate
//
// Idempotent + safe to re-run. DDL matches the drizzle schema so a later
// `db:push` sees no diff.

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  try {
    await withSuperAdmin(db, async (tx) => {
      // --- enums (guarded) ---------------------------------------------------
      await tx.execute(sql`
        DO $$ BEGIN
          CREATE TYPE flow_subject_type AS ENUM ('form_template', 'module');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `)
      await tx.execute(sql`
        DO $$ BEGIN
          CREATE TYPE flow_gate_status AS ENUM ('pending', 'approved', 'rejected');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `)
      await tx.execute(sql`
        DO $$ BEGIN
          CREATE TYPE email_template_category AS ENUM
            ('general', 'notification', 'reminder', 'approval', 'digest', 'marketing');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `)

      // --- form_automations → polymorphic ------------------------------------
      await tx.execute(sql`
        ALTER TABLE form_automations
          ADD COLUMN IF NOT EXISTS subject_type flow_subject_type NOT NULL DEFAULT 'form_template'
      `)
      await tx.execute(sql`ALTER TABLE form_automations ADD COLUMN IF NOT EXISTS subject_key text`)
      await tx.execute(sql`ALTER TABLE form_automations ALTER COLUMN template_id DROP NOT NULL`)
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS form_automations_subject_idx
          ON form_automations (tenant_id, subject_type, subject_key)
      `)
      const res = await tx.execute(sql`
        UPDATE form_automations SET subject_key = template_id::text
        WHERE subject_key IS NULL AND template_id IS NOT NULL
      `)
      const n = (res as unknown as { count?: number }).count ?? 0

      // --- flow_gates --------------------------------------------------------
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS flow_gates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          subject_type flow_subject_type NOT NULL,
          subject_key text,
          subject_id uuid NOT NULL,
          flow_id uuid NOT NULL REFERENCES form_automations(id) ON DELETE CASCADE,
          node_id text NOT NULL,
          title text NOT NULL,
          assignee_tenant_user_id uuid REFERENCES tenant_users(id),
          status flow_gate_status NOT NULL DEFAULT 'pending',
          signature_required boolean NOT NULL DEFAULT false,
          signature_data_url text,
          comment text,
          decided_by_tenant_user_id uuid REFERENCES tenant_users(id),
          decided_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `)
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS flow_gates_subject_idx
          ON flow_gates (tenant_id, subject_type, subject_id, status)
      `)
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS flow_gates_assignee_idx
          ON flow_gates (tenant_id, assignee_tenant_user_id, status)
      `)
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS flow_gates_flow_idx ON flow_gates (flow_id)`)

      // --- email_templates ---------------------------------------------------
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS email_templates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          key text NOT NULL,
          name text NOT NULL,
          description text,
          category email_template_category NOT NULL DEFAULT 'general',
          subject_template text NOT NULL DEFAULT '',
          design jsonb NOT NULL DEFAULT '{}'::jsonb,
          compiled_html text NOT NULL DEFAULT '',
          mjml_source text,
          merge_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
          is_active boolean NOT NULL DEFAULT true,
          created_by_tenant_user_id uuid REFERENCES tenant_users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz
        )
      `)
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS email_templates_tenant_idx ON email_templates (tenant_id)
      `)
      await tx.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS email_templates_tenant_key_ux
          ON email_templates (tenant_id, key)
      `)
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS email_templates_category_idx
          ON email_templates (tenant_id, category)
      `)

      console.log(
        `✔ unified-flows schema ensured (form_automations backfilled ${n} flow(s); flow_gates + email_templates ready).`,
      )
    })
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
