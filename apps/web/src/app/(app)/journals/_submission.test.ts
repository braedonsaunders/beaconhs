import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  event: vi.fn(),
  audit: vi.fn(),
  compliance: vi.fn(),
  ai: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.context }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.audit, recordAudit: vi.fn() }))
vi.mock('@beaconhs/events', () => ({
  recordDomainEvent: mocks.event,
  moduleFlowCommand: vi.fn().mockReturnValue({}),
  recordModuleFlowEvent: vi.fn(),
}))
vi.mock('@beaconhs/compliance', () => ({ materializeEvidenceTargetObligations: mocks.compliance }))
vi.mock('@/lib/ai-config', () => ({
  getTenantAutoJournalAi: mocks.ai,
  getTenantAutoJournalAnalysis: mocks.ai,
  getTenantAiConfig: vi.fn(),
}))
vi.mock('./_lib', async (original) => ({
  ...(await original<typeof import('./_lib')>()),
  getAuthorPersonId: vi.fn().mockResolvedValue(null),
}))
vi.mock('./_data', () => ({
  getOrCreateEntryForDate: vi.fn(),
  getEntry: vi.fn(),
  buildTree: vi.fn(),
  getWorkspaceData: vi.fn(),
}))
vi.mock('./_send-email', () => ({ sendJournalEntryEmail: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { submitEntry } from './_actions'

const id = '10000000-0000-4000-8000-000000000001'
function setup(
  submitted: boolean,
  existingStatus: string | null = 'draft',
  requirements = { hasLocation: true, hasSupervisor: false },
) {
  let predicate: SQL | undefined
  const tx = {
    update: () => ({
      set: () => ({
        where: (where: SQL) => {
          predicate = where
          return { returning: async () => (submitted ? [{ reference: 'JRN-1' }] : []) }
        },
      }),
    }),
    select: () => {
      const query = {
        from: () => query,
        where: () => query,
        limit: async () => (existingStatus ? [{ status: existingStatus, ...requirements }] : []),
      }
      return query
    },
  }
  mocks.context.mockResolvedValue({
    tenantId: id,
    userId: 'actor',
    isSuperAdmin: true,
    membership: { id },
    db: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  })
  return () => new PgDialect().sqlToQuery(predicate!)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ai.mockResolvedValue(false)
})

describe('journal submission requirements', () => {
  it('requires an active supervisor in the atomic update, including for administrators', async () => {
    const query = setup(false)
    expect(await submitEntry(id)).toEqual({
      ok: false,
      error: 'Choose an active supervisor before submitting your journal.',
    })
    const compiled = query()
    expect(compiled.sql).toContain('exists (')
    expect(compiled.sql).toContain('"people"."id" = "journal_entries"."supervisor_person_id"')
    expect(compiled.sql).toContain('"people"."tenant_id" = "journal_entries"."tenant_id"')
    expect(compiled.sql).toContain('"people"."deleted_at" is null')
    expect(compiled.sql).toContain('"org_units"."id" = "journal_entries"."site_org_unit_id"')
    expect(compiled.sql).toContain('"org_units"."tenant_id" = "journal_entries"."tenant_id"')
    expect(compiled.sql).toContain('"org_units"."deleted_at" is null')
    expect(compiled.params).toContain('active')
    expect(compiled.params).toContain('draft')
    expect(mocks.event).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.compliance).not.toHaveBeenCalled()
    expect(mocks.ai).not.toHaveBeenCalled()
  })

  it.each([
    [
      { hasLocation: false, hasSupervisor: true },
      'Choose a location before submitting your journal.',
    ],
    [
      { hasLocation: false, hasSupervisor: false },
      'Choose a location and an active supervisor before submitting your journal.',
    ],
  ])('names the missing requirement for a draft (%o)', async (requirements, error) => {
    setup(false, 'draft', requirements)
    expect(await submitEntry(id)).toEqual({ ok: false, error })
    expect(mocks.event).not.toHaveBeenCalled()
  })

  it.each([
    ['submitted', 'This entry has already been submitted.'],
    ['archived', 'This entry has already been submitted.'],
    [null, 'Entry not found.'],
  ])('does not expose supervisor validation for a %s entry', async (status, error) => {
    setup(false, status)
    expect(await submitEntry(id)).toEqual({ ok: false, error })
    expect(mocks.event).not.toHaveBeenCalled()
  })

  it('keeps successful submission, events, audit, and compliance in the same transaction', async () => {
    setup(true)
    expect(await submitEntry(id)).toEqual({ ok: true })
    expect(mocks.event).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'journal_entry.submitted', subjectId: id }),
    )
    expect(mocks.audit).toHaveBeenCalledOnce()
    expect(mocks.compliance).toHaveBeenCalledOnce()
  })
})
