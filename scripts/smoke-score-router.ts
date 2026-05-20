// Smoke test for score-based routing + spawn-CAPA-from-response.
//
// Exercises:
//   1. computeFormScore over a schema with a pass_fail_na field that 'fail's
//   2. Persist a form_response with the computed compliance fields
//   3. Spawn a CAPA via the server-action-shaped DB write
//   4. Verify the CA references the response via source_form_response_id
//
// Run with:
//   pnpm exec tsx --env-file=../../.env scripts/smoke-score-router.ts
// (from any package directory)

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import {
  correctiveActions,
  formResponses,
  formTemplateVersions,
  formTemplates,
} from '@beaconhs/db/schema'
import { computeFormScore } from '../apps/web/src/app/(app)/forms/_lib/score-router'

const TENANT_ID = 'eaede59e-a090-4a72-b09c-ee82c1ac2e06'

const url =
  process.env.DATABASE_URL ??
  'postgresql://beaconhs:beaconhs@localhost:5433/beaconhs'
const sql = postgres(url, { max: 1 })
const db = drizzle(sql)

const schema = {
  schemaVersion: 1 as const,
  title: { en: 'Smoke template' },
  sections: [
    {
      id: 's1',
      title: { en: 'Inspection' },
      fields: [
        {
          id: 'criterion_a',
          type: 'pass_fail_na' as const,
          label: { en: 'Wheels intact' },
        },
        {
          id: 'criterion_b',
          type: 'pass_fail_na' as const,
          label: { en: 'Brake fluid OK' },
        },
        {
          id: 'criterion_c',
          type: 'pass_fail_na' as const,
          label: { en: 'Lights working' },
        },
      ],
    },
  ],
  workflow: {
    steps: [
      {
        key: 'submit',
        title: { en: 'Submit' },
        assignee: { type: 'role' as const, role: 'foreman' },
      },
    ],
  },
}

const values = {
  criterion_a: 'pass',
  criterion_b: 'fail',
  criterion_c: 'fail',
}

const verdict = computeFormScore(schema as any, values, {})
console.log('Score verdict:', verdict)

if (verdict.status !== 'non_compliant') {
  console.error('FAIL: expected non_compliant')
  process.exit(1)
}
if (
  !verdict.failedFieldKeys.includes('criterion_b') ||
  !verdict.failedFieldKeys.includes('criterion_c')
) {
  console.error('FAIL: missing failed field keys')
  process.exit(1)
}
console.log('PASS: score routing flagged non_compliant + 2 failed fields')

async function main() {
  const [tpl] = await db
    .insert(formTemplates)
    .values({
      tenantId: TENANT_ID,
      key: `smoke-${Date.now()}`,
      name: 'Smoke equipment inspection',
      category: 'inspection',
      status: 'published',
    })
    .returning()
  console.log('Created template', tpl!.id)

  const [ver] = await db
    .insert(formTemplateVersions)
    .values({
      tenantId: TENANT_ID,
      templateId: tpl!.id,
      version: 1,
      schema: schema as any,
      publishedAt: new Date(),
    })
    .returning()
  console.log('Created version', ver!.id)

  const [resp] = await db
    .insert(formResponses)
    .values({
      tenantId: TENANT_ID,
      templateId: tpl!.id,
      templateVersionId: ver!.id,
      status: verdict.status === 'non_compliant' ? 'non_compliant' : 'submitted',
      data: values,
      submittedAt: new Date(),
      complianceScore: String(verdict.score),
      complianceStatus: verdict.status,
    })
    .returning()
  console.log('Created response', resp!.id, 'status:', resp!.status)
  console.log('Persisted compliance:', resp!.complianceScore, resp!.complianceStatus)

  if (resp!.status !== 'non_compliant') {
    console.error('FAIL: response status not non_compliant')
    process.exit(1)
  }
  if (resp!.complianceStatus !== 'non_compliant') {
    console.error('FAIL: compliance_status not non_compliant')
    process.exit(1)
  }

  const [ca] = await db
    .insert(correctiveActions)
    .values({
      tenantId: TENANT_ID,
      reference: `CA-SMOKE-${Date.now()}`,
      title: `Address non-compliance in ${tpl!.name} (${resp!.id.slice(0, 8)})`,
      description: `Auto from response. Score: ${verdict.score}. Failed: ${verdict.failedFieldKeys.join(', ')}`,
      severity: 'high',
      source: 'inspection',
      sourceEntityType: 'form_response',
      sourceEntityId: resp!.id,
      sourceFormResponseId: resp!.id,
      assignedOn: new Date().toISOString().slice(0, 10),
    })
    .returning()
  console.log('Created CAPA', ca!.id, 'linked to response', ca!.sourceFormResponseId)

  if (ca!.sourceFormResponseId !== resp!.id) {
    console.error('FAIL: CAPA not linked to response')
    process.exit(1)
  }

  const cas = await db
    .select()
    .from(correctiveActions)
    .where(eq(correctiveActions.sourceFormResponseId, resp!.id))
  console.log(`Found ${cas.length} CAPA(s) linked to response`)
  if (cas.length !== 1) {
    console.error('FAIL: expected 1 linked CAPA')
    process.exit(1)
  }

  console.log('\nALL SMOKE CHECKS PASSED')
  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
