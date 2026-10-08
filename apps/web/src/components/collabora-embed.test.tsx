// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
vi.mock('@/components/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('@/components/brand-logo', () => ({ LogoMark: () => null }))
vi.mock('@beaconhs/ui', () => ({ cn: (...values: string[]) => values.filter(Boolean).join(' ') }))
import { CollaboraEmbed, type CollaboraHandle } from './collabora-embed'
let root: Root
let container: HTMLDivElement
let ref: ReturnType<typeof createRef<CollaboraHandle>>
const session = {
  ok: true as const,
  actionUrl: 'http://localhost:3000/browser/hash/cool.html?WOPISrc=example',
  accessToken: 'test-token',
  accessTokenTtl: 1,
}
const submit = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(submit)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  ref = createRef<CollaboraHandle>()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function mount() {
  await act(async () =>
    root.render(<CollaboraEmbed ref={ref} frameName="doc" fetchSession={async () => session} />),
  )
}
async function message(status: string, trusted = true) {
  const frame = container.querySelector('iframe')!
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: new URL(session.actionUrl).origin,
        source: trusted ? frame.contentWindow : window,
        data: JSON.stringify({ MessageId: 'App_LoadingStatus', Values: { Status: status } }),
      }),
    ),
  )
}
describe('Collabora startup and publication readiness', () => {
  it('bounds a stalled branding fetch before starting the editor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('timed out')))
          }),
      ),
    )
    await mount()
    expect(submit).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(2_000))
    expect(submit).toHaveBeenCalledOnce()
    expect(ref.current!.isLoaded()).toBe(false)
  })
  it('handshakes early, but only allows saves after the document actually loads', async () => {
    await mount()
    const post = vi.spyOn(container.querySelector('iframe')!.contentWindow!, 'postMessage')
    await message('Initialized', false)
    expect(post).not.toHaveBeenCalled()
    await message('Initialized')
    expect(JSON.parse(post.mock.calls[0]![0] as string).MessageId).toBe('Host_PostmessageReady')
    await message('Frame_Ready')
    expect(container.querySelector('.absolute')).toBeNull()
    await expect(ref.current!.save()).rejects.toThrow('finish loading')
    await message('Document_Loaded')
    expect(ref.current!.isLoaded()).toBe(true)
    const saved = ref.current!.save()
    const frame = container.querySelector('iframe')!
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: new URL(session.actionUrl).origin,
          source: frame.contentWindow,
          data: { MessageId: 'Action_Save_Resp', Values: { success: true, result: 'saved' } },
        }),
      ),
    )
    await expect(saved).resolves.toBeUndefined()
  })
  it('reveals a stalled editor without pretending it is safe to publish', async () => {
    await mount()
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect(container.querySelector('.absolute')).toBeNull()
    expect(ref.current!.isLoaded()).toBe(false)
    await expect(ref.current!.save()).rejects.toThrow('finish loading')
  })
})
