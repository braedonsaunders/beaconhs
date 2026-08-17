import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  can: vi.fn(),
  certificate: vi.fn(),
  render: vi.fn(),
  audit: vi.fn(),
  parseIds: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.requireContext }))
vi.mock('@beaconhs/tenant', () => ({ can: mocks.can }))
vi.mock('@/lib/training-credential-access', () => ({
  trainingCertificateForRecord: mocks.certificate,
}))
vi.mock('@/lib/training-credential-pdf', () => ({
  renderTrainingWalletCardBatchPdf: mocks.render,
}))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@/lib/bulk-actions', () => ({ parseBulkActionIds: mocks.parseIds }))

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireContext.mockResolvedValue({ tenantId: 'tenant-1' })
  mocks.can.mockReturnValue(true)
  mocks.parseIds.mockReturnValue({ ok: true, ids })
  mocks.certificate
    .mockResolvedValueOnce({ certificateId: 'certificate-1' })
    .mockResolvedValueOnce({ error: 'revoked', status: 409 })
  mocks.render.mockResolvedValue({
    bytes: Buffer.from('pdf'),
    filename: 'wallet-cards.pdf',
    rendered: 1,
    skipped: 0,
  })
})

describe('bulk training wallet cards', () => {
  it('renders accessible records into one audited PDF and reports skips', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.test/training/records/wallet-cards', {
        method: 'POST',
        body: JSON.stringify({ recordIds: ids }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('X-Rendered-Records')).toBe('1')
    expect(response.headers.get('X-Skipped-Records')).toBe('1')
    expect(mocks.render).toHaveBeenCalledWith(expect.anything(), ['certificate-1'])
    expect(mocks.audit).toHaveBeenCalledOnce()
  })

  it('rejects an invalid selection before rendering', async () => {
    mocks.parseIds.mockReturnValue({ ok: false, error: 'The record selection is invalid.' })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.test/training/records/wallet-cards', {
        method: 'POST',
        body: JSON.stringify({ recordIds: ['not-a-uuid'] }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.render).not.toHaveBeenCalled()
  })
})
