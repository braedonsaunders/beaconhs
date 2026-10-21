// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOOT_SPLASH_INIT } from '@/lib/boot-splash'
import Loading from '@/app/loading'
import { SplashScreen } from './brand-splash'

vi.mock('./brand-logo', () => ({ BrandSplash: () => <div data-startup-logo /> }))
vi.mock('@beaconhs/ui', () => ({
  cn: (...values: string[]) => values.join(' '),
  Skeleton: () => <div data-skeleton />,
}))

let root: Root
let container: HTMLDivElement
const initializeDocument = () => Function(BOOT_SPLASH_INIT)()
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  sessionStorage.clear()
  delete document.documentElement.dataset.beaconSplash
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  sessionStorage.clear()
  delete document.documentElement.dataset.beaconSplash
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('tab startup splash', () => {
  it('plays on a fresh tab, fades once, and never returns for uncached route loading', () => {
    initializeDocument()
    expect(document.documentElement.dataset.beaconSplash).toBe('show')
    act(() => root.render(<SplashScreen />))
    expect(container.querySelector('[data-boot-splash]')?.className).toContain('opacity-100')
    advance(2_000)
    expect(container.querySelector('[data-boot-splash]')?.className).toContain('opacity-0')
    advance(400)
    expect(container.querySelector('[data-startup-logo]')).toBeNull()
    for (const page of ['admin', 'audit-log', 'dashboard']) {
      act(() =>
        root.render(
          <>
            <SplashScreen />
            <Loading key={page} />
          </>,
        ),
      )
      advance(0)
      expect(container.querySelector('[data-startup-logo]')).toBeNull()
      expect(container.querySelector('[role="progressbar"]')).not.toBeNull()
    }
  })

  it('hides subsequent documents before hydration and allows a new tab session', () => {
    initializeDocument()
    delete document.documentElement.dataset.beaconSplash
    initializeDocument()
    expect(document.documentElement.dataset.beaconSplash).toBe('skip')
    act(() => root.render(<SplashScreen />))
    advance(0)
    expect(container.querySelector('[data-boot-splash]')).toBeNull()
    sessionStorage.clear()
    initializeDocument()
    expect(document.documentElement.dataset.beaconSplash).toBe('show')
  })

  it('plays the full animation even when document loading and hydration took longer', () => {
    vi.mocked(performance.now).mockReturnValue(8_000)
    initializeDocument()
    act(() => root.render(<SplashScreen />))
    advance(1_999)
    expect(container.querySelector('[data-boot-splash]')?.className).toContain('opacity-100')
    advance(1)
    expect(container.querySelector('[data-boot-splash]')?.className).toContain('opacity-0')
    advance(400)
    expect(container.querySelector('[data-boot-splash]')).toBeNull()
    initializeDocument()
    expect(document.documentElement.dataset.beaconSplash).toBe('skip')
  })

  it('still completes when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    expect(initializeDocument).not.toThrow()
    expect(document.documentElement.dataset.beaconSplash).toBe('show')
    act(() => root.render(<SplashScreen />))
    advance(2_400)
    expect(container.querySelector('[data-boot-splash]')).toBeNull()
  })

  it('respects reduced motion under Strict Mode without shortening the static display', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    vi.mocked(performance.now).mockReturnValue(450)
    initializeDocument()
    act(() =>
      root.render(
        <StrictMode>
          <SplashScreen />
        </StrictMode>,
      ),
    )
    advance(499)
    expect(container.querySelector('[data-boot-splash]')?.className).toContain('opacity-100')
    advance(1)
    expect(container.querySelector('[data-boot-splash]')?.className).toContain('opacity-0')
    advance(400)
    expect(container.querySelector('[data-boot-splash]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
