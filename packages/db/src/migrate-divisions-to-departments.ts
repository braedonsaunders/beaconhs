// One-off data migration: collapse the (now-removed) `person_divisions`
// taxonomy into the single `departments` concept. Run this BEFORE `db:push`
// drops the division tables + `people.division_ids` column.
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/migrate-divisions-to-departments.ts
//
// Idempotent + safe to re-run: it bails if the division tables are already
// gone, only fills NULL department_id, dedupes departments by (tenant, name),
// and only rewrites role scopes that still carry the legacy `divisionIds` key.
// Runs cross-tenant under bypass_rls.

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  try {
    const present = await db.execute(sql`select to_regclass('public.person_divisions')::text as t`)
    const exists = (present as unknown as { t: string | null }[])[0]?.t
    if (!exists) {
      console.log('person_divisions no longer exists — nothing to migrate.')
      return
    }

    // Add departments.description ahead of `db:push` so we can carry division
    // descriptions across. Idempotent; push later sees it already present.
    await db.execute(sql`ALTER TABLE departments ADD COLUMN IF NOT EXISTS description text`)

    await withSuperAdmin(db, async (tx) => {
      // 1. Create a department for every division name not already present.
      const inserted = await tx.execute(sql`
        INSERT INTO departments (tenant_id, name, code, description)
        SELECT pd.tenant_id, pd.name, pd.code, pd.description
        FROM person_divisions pd
        WHERE pd.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM departments d
            WHERE d.tenant_id = pd.tenant_id AND lower(d.name) = lower(pd.name)
          )
        ON CONFLICT DO NOTHING
        RETURNING id
      `)

      // 2. Give each person their (earliest) division as a department, but only
      //    if they don't already have one — a person collapses to one department.
      const updated = await tx.execute(sql`
        UPDATE people p
        SET department_id = d.id
        FROM (
          SELECT DISTINCT ON (pdm.person_id)
                 pdm.person_id, pdm.tenant_id, pd.name
          FROM person_division_memberships pdm
          JOIN person_divisions pd ON pd.id = pdm.division_id
          ORDER BY pdm.person_id, pdm.created_at ASC
        ) m
        JOIN departments d
          ON d.tenant_id = m.tenant_id AND lower(d.name) = lower(m.name)
        WHERE p.id = m.person_id
          AND p.tenant_id = m.tenant_id
          AND p.department_id IS NULL
        RETURNING p.id
      `)

      // 3. Rewrite team role-scopes: divisionIds (division uuids) → departmentIds
      //    (mapped dept uuids by name). groupIds preserved; legacy key dropped.
      const remapped = await tx.execute(sql`
        WITH div_to_dept AS (
          SELECT pd.id AS division_id, d.id AS department_id
          FROM person_divisions pd
          JOIN departments d
            ON d.tenant_id = pd.tenant_id AND lower(d.name) = lower(pd.name)
        ),
        team AS (
          SELECT ra.id,
                 COALESCE(
                   (SELECT jsonb_agg(DISTINCT dd.department_id)
                    FROM jsonb_array_elements_text(ra.scope->'divisionIds') AS x(div)
                    JOIN div_to_dept dd ON dd.division_id = x.div::uuid),
                   '[]'::jsonb
                 ) AS dept_ids,
                 COALESCE(ra.scope->'groupIds', '[]'::jsonb) AS group_ids
          FROM role_assignments ra
          WHERE ra.scope->>'type' = 'team'
            AND ra.scope ? 'divisionIds'
        )
        UPDATE role_assignments ra
        SET scope = jsonb_build_object(
              'type', 'team',
              'departmentIds', team.dept_ids,
              'groupIds', team.group_ids
            )
        FROM team
        WHERE ra.id = team.id
        RETURNING ra.id
      `)

      const len = (r: unknown) => (r as unknown as unknown[]).length
      console.log(`  · departments created from divisions: ${len(inserted)}`)
      console.log(`  · people given a department:          ${len(updated)}`)
      console.log(`  · team role-scopes remapped:          ${len(remapped)}`)
    })

    // Data is now safely in `departments` — drop the redundant division tables
    // + the denormalised cache column. Idempotent; `db:push` later is a no-op
    // for these. (DDL, so no RLS bypass needed.)
    await db.execute(sql`DROP TABLE IF EXISTS person_division_memberships CASCADE`)
    await db.execute(sql`DROP TABLE IF EXISTS person_divisions CASCADE`)
    await db.execute(sql`ALTER TABLE people DROP COLUMN IF EXISTS division_ids`)
    console.log('  · dropped person_divisions, person_division_memberships, people.division_ids')
  } finally {
    await pg.end({ timeout: 5 })
  }
}

main()
  .then(() => {
    console.log('✔ divisions → departments data migration complete')
    process.exit(0)
  })
  .catch((e) => {
    console.error('✖ migration failed:', e)
    process.exit(1)
  })
