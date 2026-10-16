// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let unregister: (() => void) | undefined
afterEach(() => {
  unregister?.()
  unregister = undefined
  vi.useRealTimers()
})

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.dplId
  history.replaceState({}, '', '/journals/private-id?secret=value')
})

describe('self-hosted browser diagnostics', () => {
  it('captures React errors without messages, page IDs, queries or full stacks', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    const { captureBrowserDiagnostic } = await import('./browser-diagnostics')
    document.documentElement.dataset.dplId = 'a'.repeat(40)
    const error = Object.assign(new TypeError('SECRET SQL form contents'), {
      digest: '123456',
      stack:
        'TypeError: SECRET SQL form contents\n    at safe (https://private-host/_next/static/chunks/abc.js?dpl=private-query:42:7)\n    at https://secret-host/profile?token=secret',
    })
    captureBrowserDiagnostic('react_boundary', error)
    expect(fetch).toHaveBeenCalledOnce()
    const body = String(fetch.mock.calls[0]?.[1]?.body)
    expect(JSON.parse(body)).toMatchObject({
      kind: 'react_boundary',
      clientRelease: 'a'.repeat(40),
      routeFamily: 'journals',
      errorType: 'TypeError',
      digest: '123456',
      positions: ['/_next/static/chunks/abc.js:42:7'],
    })
    expect(body).not.toMatch(/SECRET|private-id|private-host|secret-host|token|form contents/)
  })

  it('deduplicates bursts and ignores benign cancellation', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    const { captureBrowserDiagnostic } = await import('./browser-diagnostics')
    captureBrowserDiagnostic(
      'unhandled_rejection',
      Object.assign(new Error('cancelled'), { name: 'AbortError' }),
    )
    captureBrowserDiagnostic(
      'unhandled_rejection',
      Object.assign(new Error('updated'), { name: 'DeploymentChangedError' }),
    )
    expect(fetch).not.toHaveBeenCalled()
    captureBrowserDiagnostic('unhandled_error', new TypeError('one'))
    captureBrowserDiagnostic('unhandled_error', new TypeError('two'))
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('captures global exceptions, rejections and stale deployments', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    const { registerBrowserDiagnostics } = await import('./browser-diagnostics')
    unregister = registerBrowserDiagnostics()
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('secret') }))
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', { value: new TypeError('secret') })
    window.dispatchEvent(rejection)
    window.dispatchEvent(
      new CustomEvent('beaconhs:deployment-stale', {
        detail: { reason: 'action_not_found', secret: 'never-log' },
      }),
    )
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).kind)).toEqual([
      'unhandled_error',
      'unhandled_rejection',
      'deployment_stale',
    ])
    expect(JSON.stringify(fetch.mock.calls)).not.toMatch(/never-log|secret/)
  })

  it('cannot crash the page when fetch, storage, or error inspection fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { captureBrowserDiagnostic } = await import('./browser-diagnostics')
    expect(() => captureBrowserDiagnostic('smoke')).not.toThrow()
    expect(() =>
      captureBrowserDiagnostic('react_boundary', {
        get name() {
          throw new Error('bad error getter')
        },
      }),
    ).not.toThrow()
    await Promise.resolve()
  })
})

it('never mistakes multiline error-message URLs for static stack frames', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  const { captureBrowserDiagnostic } = await import('./browser-diagnostics')
  const message = 'user input\n    at https://host/_next/static/private-customer-text.js:1:1'
  const error = new Error(message)
  error.stack = `Error: ${message}\n    at safe (https://host/_next/static/chunks/real.js:2:3)`
  captureBrowserDiagnostic('unhandled_error', error)
  const body = String(fetch.mock.calls[0]?.[1]?.body)
  expect(JSON.parse(body).positions).toEqual(['/_next/static/chunks/real.js:2:3'])
  expect(body).not.toMatch(/private-customer-text|user input/)
})

it('captures one bounded delayed visible heartbeat and ignores the following healthy tick', async () => {
  vi.useFakeTimers()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const { registerBrowserDiagnostics } = await import('./browser-diagnostics')
  unregister = registerBrowserDiagnostics()
  now = 8_000
  vi.advanceTimersByTime(2_000)
  now = 10_000
  vi.advanceTimersByTime(2_000)
  expect(fetch).toHaveBeenCalledOnce()
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
    kind: 'event_loop_delay',
    delayMs: 6_000,
  })
})

it('resets the heartbeat for hidden/resumed pages, focus, page lifecycle and long suspension', async () => {
  vi.useFakeTimers()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  let now = 0
  let visibility: DocumentVisibilityState = 'visible'
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  const { registerBrowserDiagnostics } = await import('./browser-diagnostics')
  unregister = registerBrowserDiagnostics()
  visibility = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  now = 20_000
  vi.advanceTimersByTime(2_000)
  visibility = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
  now = 22_000
  vi.advanceTimersByTime(2_000)
  now = 40_000
  window.dispatchEvent(new Event('focus'))
  now = 42_000
  vi.advanceTimersByTime(2_000)
  window.dispatchEvent(new Event('pagehide'))
  now = 55_000
  vi.advanceTimersByTime(2_000)
  window.dispatchEvent(new Event('pageshow'))
  now = 57_000
  vi.advanceTimersByTime(2_000)
  now = 100_000
  vi.advanceTimersByTime(2_000)
  now = 102_000
  vi.advanceTimersByTime(2_000)
  expect(fetch).not.toHaveBeenCalled()
  unregister()
  unregister = undefined
  expect(vi.getTimerCount()).toBe(0)
})
