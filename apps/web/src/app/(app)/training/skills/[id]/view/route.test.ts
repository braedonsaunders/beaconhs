import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  manage: vi.fn(),
  visible: vi.fn(),
  audit: vi.fn(),
  outputs: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.auth }))
vi.mock('@/lib/module-admin/guard', () => ({ canManageModule: mocks.manage }))
vi.mock('@beaconhs/tenant/visibility', () => ({ canSeeRecord: mocks.visible }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@/lib/credential-designs', () => ({ skillCredentialOutputs: mocks.outputs }))
import { GET } from './route'

const id = '00000000-0000-4000-8000-000000000001'
const attachmentId = '00000000-0000-4000-8000-000000000002'
let limit: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('PUBLIC_APP_URL', 'https://beaconhs.example.test/')
  vi.stubEnv('ATTACHMENT_CAPABILITY_SECRET', 'skill-view-regression-secret-32-characters')
  limit = vi.fn()
  const query = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit,
  }
  mocks.auth.mockResolvedValue({
    tenantId: id,
    db: async (run: (tx: unknown) => unknown) => run({ select: vi.fn().mockReturnValue(query) }),
  })
  mocks.manage.mockReturnValue(true)
})
afterEach(() => vi.unstubAllEnvs())

function request() {
  return new Request(`http://0.0.0.0:3000/training/skills/${id}/view`, {
    headers: { 'x-forwarded-host': 'untrusted.example' },
  })
}
function assignment(viewSource = 'uploaded', evidenceAttachmentId: string | null = null) {
  return [
    {
      assignment: { personId: id, evidenceAttachmentId },
      type: { viewSource, credentialOutputIds: ['wallet'] },
    },
  ]
}

describe('skill credential View behind the production proxy', () => {
  it('redirects uploaded evidence to the configured public host with its capability intact', async () => {
    limit.mockResolvedValueOnce(assignment('uploaded', attachmentId)).mockResolvedValueOnce([])
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    const target = new URL(response.headers.get('location')!)
    expect(response.status).toBe(307)
    expect(target.origin).toBe('https://beaconhs.example.test')
    expect(target.pathname).toBe(`/api/attachments/${attachmentId}`)
    expect(target.searchParams.get('cap')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mocks.audit).toHaveBeenCalledOnce()
  })

  it('keeps generated credential output selection on the public host', async () => {
    limit.mockResolvedValueOnce(assignment('generated')).mockResolvedValueOnce([{ settings: {} }])
    mocks.outputs.mockReturnValue([{ id: 'wallet design' }])
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    expect(response.headers.get('location')).toBe(
      `https://beaconhs.example.test/training/skills/${id}/certificate?output=wallet%20design`,
    )
  })

  it('opens the files tab on the public host when no credential has been uploaded', async () => {
    limit.mockResolvedValueOnce(assignment()).mockResolvedValueOnce([])
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    expect(response.headers.get('location')).toBe(
      `https://beaconhs.example.test/training/skills/${id}?tab=files`,
    )
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('does not redirect records the user cannot access', async () => {
    limit.mockResolvedValueOnce(assignment())
    mocks.manage.mockReturnValue(false)
    mocks.visible.mockResolvedValue(false)
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(404)
    expect(response.headers.has('location')).toBe(false)
  })
})
