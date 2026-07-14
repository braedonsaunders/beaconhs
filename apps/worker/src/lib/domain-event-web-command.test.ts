import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchDomainEventWebCommand } from './domain-event-web-command'

const EVENT_ID = '10000000-0000-4000-8000-000000000001'
const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.INTERNAL_WEB_URL = 'http://web:3000'
  process.env.BETTER_AUTH_SECRET = 'domain-event-test-secret-with-sufficient-entropy'
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
})

describe('domain event web command transport', () => {
  it('rejects malformed event identity and base URL before fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(dispatchDomainEventWebCommand('not-an-id')).rejects.toThrow(/UUID/)
    process.env.INTERNAL_WEB_URL = 'file:///etc/passwd'
    await expect(dispatchDomainEventWebCommand(EVENT_ID)).rejects.toThrow(/HTTP\(S\) origin/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not follow redirects and bounds failing response bodies', async () => {
    const huge = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(100_000)))
        controller.close()
      },
    })
    const fetchMock = vi.fn(async () => new Response(huge, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(dispatchDomainEventWebCommand(EVENT_ID)).rejects.toThrow(
      /^Web domain command failed \(500\): x{500}$/,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(`http://web:3000/api/internal/domain-events/${EVENT_ID}`),
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    )
  })
})
