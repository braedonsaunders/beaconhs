// One-off, idempotent backfill: copy any in-flight PENDING form-gate rows out of
// the legacy form_response_steps (stepKey `gate:{flowId}:{nodeId}`) into the new
// unified flow_gates store, so approvals already awaiting a decision survive the
// cutover. Resolved gates stay as history in form_response_steps.
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/migrate-flow-gates-backfill.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  try {
    await withSuperAdmin(db, async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO flow_gates
          (tenant_id, subject_type, subject_key, subject_id, flow_id, node_id, title,
           assignee_tenant_user_id, status, signature_required, created_at, updated_at)
        SELECT s.tenant_id, 'form_template', r.template_id::text, s.response_id,
               split_part(s.step_key, ':', 2)::uuid,
               split_part(s.step_key, ':', 3),
               COALESCE(NULLIF(s.comment, ''), 'Approval'),
               s.assignee_tenant_user_id,
               'pending', false, now(), now()
        FROM form_response_steps s
        JOIN form_responses r ON r.id = s.response_id
        WHERE s.status = 'pending'
          AND s.step_key LIKE 'gate:%'
          AND split_part(s.step_key, ':', 2) ~ '^[0-9a-fA-F-]{36}$'
          AND split_part(s.step_key, ':', 3) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM flow_gates g
            WHERE g.subject_type = 'form_template'
              AND g.subject_id = s.response_id
              AND g.flow_id = split_part(s.step_key, ':', 2)::uuid
              AND g.node_id = split_part(s.step_key, ':', 3)
          )
      `)
      const n = (res as unknown as { count?: number }).count ?? 0
      console.log(`✔ migrated ${n} pending form gate(s) → flow_gates`)
    })
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
