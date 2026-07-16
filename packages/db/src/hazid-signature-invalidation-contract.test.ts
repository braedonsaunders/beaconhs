import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(new URL('../drizzle/0008_hazid_review_conditions_signatures.sql', import.meta.url)),
  'utf8',
)

describe('hazard assessment signature invalidation migration', () => {
  it('covers every native content table and embedded Builder response data', () => {
    for (const table of [
      'hazid_assessments',
      'hazid_assessment_tasks',
      'hazid_assessment_hazards',
      'hazid_assessment_ppe',
      'hazid_assessment_questions',
      'hazid_assessment_photos',
      'hazid_assessment_app_responses',
      'form_responses',
    ]) {
      expect(migration).toContain(`ON "${table}"`)
    }
  })

  it('excludes lock, review, PDF, and signature-only state from material changes', () => {
    expect(migration).toContain("'locked_by_tenant_user_id'")
    expect(migration).toContain("'review_status'")
    expect(migration).toContain("'pdf_attachment_id'")
    expect(migration).toContain("'workflow_state'")
    expect(migration).not.toContain(
      'ON "hazid_assessment_signatures"\nFOR EACH ROW EXECUTE FUNCTION',
    )
  })

  it('deletes invalidated signature attachments through the durable outbox trigger', () => {
    expect(migration).toContain('DELETE FROM "attachments" AS attachment')
    expect(migration).toContain('attachment."kind" = \'signature\'')
  })
})
