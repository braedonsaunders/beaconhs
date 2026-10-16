import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ register: vi.fn(), capture: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureRequestError: mocks.capture }))
vi.mock('./lib/http-response-diagnostics', () => ({
  registerHttpResponseDiagnostics: mocks.register,
}))
vi.mock('./sentry.server.config', () => {
  throw new Error('sensitive optional service config')
})
import { onRequestError, register } from './instrumentation'

beforeEach(() => {
  vi.restoreAllMocks()
  mocks.register.mockReset()
  mocks.capture.mockReset()
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
})

describe('resilient server instrumentation', () => {
  it('keeps local capture registered when optional Sentry initialization fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(register()).resolves.toBeUndefined()
    expect(mocks.register).toHaveBeenCalledOnce()
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'monitoring_initialization_failed',
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive')
  })

  it('does not reject an error hook when the optional capture promise rejects', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.capture.mockRejectedValueOnce(new Error('optional service failure'))
    await expect(
      onRequestError(
        new TypeError('SQL secret'),
        {
          method: 'POST',
          path: '/journals/private-id?token=secret',
          headers: { cookie: 'secret' },
        },
        {
          routerKind: 'App Router',
          routePath: '/journals/[id]',
          routeType: 'action',
          revalidateReason: undefined,
        },
      ),
    ).resolves.toBeUndefined()
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'request_error',
      routeFamily: 'journals',
      errorType: 'TypeError',
    })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SQL|secret|private-id|cookie/)
  })
})
