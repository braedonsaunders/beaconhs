import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  open: vi.fn(),
  entry: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.context }))
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(), recordAuditInTransaction: vi.fn() }))
vi.mock('@/lib/ai-config', () => ({
  getTenantAiConfig: vi.fn(),
  getTenantAutoJournalAi: vi.fn(),
  getTenantAutoJournalAnalysis: vi.fn(),
}))
vi.mock('@beaconhs/events', () => ({
  recordDomainEvent: vi.fn(),
  moduleFlowCommand: vi.fn(),
  recordModuleFlowEvent: vi.fn(),
}))
vi.mock('./_data', () => ({
  getOrCreateEntryForDate: mocks.open,
  getEntry: mocks.entry,
  buildTree: vi.fn(),
  getWorkspaceData: vi.fn(),
}))
vi.mock('./_send-email', () => ({ sendJournalEntryEmail: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { createEntryForDate } from './_actions'

const context = { tenantId: 'tenant', isSuperAdmin: true, timezone: 'America/Toronto' }
const entry = { id: 'entry', status: 'draft', supervisorPersonId: null }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue(context)
  mocks.open.mockResolvedValue(entry.id)
  mocks.entry.mockResolvedValue(entry)
})
describe('create or resume directly into the journal editor', () => {
  it.each([undefined, '2026-10-04'])(
    'returns the full entry for %s in the same authorized context',
    async (date) => {
      expect(await createEntryForDate(date)).toEqual({ ok: true, entry })
      expect(mocks.open).toHaveBeenCalledExactlyOnceWith(context, date)
      expect(mocks.entry).toHaveBeenCalledExactlyOnceWith(context, entry.id)
      expect(mocks.revalidate).toHaveBeenCalledWith('/journals')
    },
  )
  it('returns an existing submitted entry instead of replacing it with a draft', async () => {
    mocks.entry.mockResolvedValueOnce({ ...entry, status: 'submitted', locked: true })
    expect(await createEntryForDate()).toEqual({
      ok: true,
      entry: { ...entry, status: 'submitted', locked: true },
    })
  })
  it.each(['2026-02-30', '2026-13-01', '', 'not-a-date'])(
    'rejects invalid date %s before accessing journal data',
    async (date) => {
      expect(await createEntryForDate(date)).toEqual({
        ok: false,
        error: 'Choose a valid journal date.',
      })
      expect(mocks.open).not.toHaveBeenCalled()
    },
  )
  it('rejects users without creation permission', async () => {
    mocks.context.mockResolvedValueOnce({ ...context, isSuperAdmin: false, permissions: new Set() })
    expect(await createEntryForDate()).toEqual({
      ok: false,
      error: 'You cannot create journal entries.',
    })
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('does not claim success when an account has no journal owner identity', async () => {
    mocks.open.mockResolvedValueOnce(null)
    expect(await createEntryForDate()).toEqual({
      ok: false,
      error:
        'Your account is not linked to a person or membership in this tenant, so it cannot own a journal.',
    })
    expect(mocks.entry).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('does not return an inaccessible or missing entry', async () => {
    mocks.entry.mockResolvedValueOnce(null)
    expect(await createEntryForDate()).toEqual({ ok: false, error: 'Could not open your journal.' })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
