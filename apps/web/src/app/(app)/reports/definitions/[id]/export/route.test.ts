import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  definition: vi.fn(),
  run: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.context }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('../../../_definitions', () => ({ loadDefinitionById: mocks.definition }))
vi.mock('../../../_run', () => ({ runReportForViewer: mocks.run, loadTenantBranding: vi.fn() }))
vi.mock('@beaconhs/forms-pdf', () => ({ renderReportPdf: vi.fn() }))
vi.mock('@/lib/report-wallet-cards', () => ({
  renderWalletCardsForReport: vi.fn(),
  reportSupportsWalletCards: vi.fn(),
}))

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const request = (query: string) =>
  GET(
    new NextRequest(`https://example.test/reports/definitions/${id}/export?format=csv&${query}`),
    { params: Promise.resolve({ id }) },
  )
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({
    tenantId: id,
    userId: 'admin',
    isSuperAdmin: false,
    permissions: new Set(['reports.read']),
  })
  mocks.definition.mockResolvedValue({
    id,
    name: 'Fleet',
    slug: 'fleet',
    query: { entity: 'equipment_fleet', groupBy: 'type_category' },
    layout: { sections: [] },
  })
  mocks.run.mockResolvedValue({
    result: { groups: [], summary: [], rowCount: 0, truncated: false, durationMs: 0 },
    error: null,
  })
})

describe('report export run controls', () => {
  it('keeps explicitly cleared filters and grouping instead of restoring saved controls', async () => {
    const filters = null
    const response = await request(
      `filters=${encodeURIComponent(JSON.stringify(filters))}&groupBy=`,
    )
    expect(response.status).toBe(200)
    expect(mocks.run.mock.calls[0]![2]).toEqual({ maxRows: 10000, filters, groupBy: null })
  })
  it('uses saved controls when no runtime override is supplied', async () => {
    expect((await request('')).status).toBe(200)
    expect(mocks.run.mock.calls[0]![2]).toEqual({
      maxRows: 10000,
      filters: undefined,
      groupBy: undefined,
    })
  })
  it('rejects malformed runtime filters before running or auditing an export', async () => {
    expect((await request('filters=invalid')).status).toBe(400)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
