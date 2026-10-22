// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignZoom } from './editor'

vi.mock('@/i18n/generated', () => ({}))

let container: HTMLDivElement
let root: Root
let controls: ReturnType<typeof useDesignZoom>
let width: number
let height: number
let notifyResize: () => void

function Probe({ artboard = { width: 4, height: 6 } }) {
  const { viewportRef, ...state } = useDesignZoom({
    artboard,
    reattachKey: 'label',
    viewportPadding: 104,
  })
  useEffect(() => {
    controls = { viewportRef, ...state }
  }, [state, viewportRef])
  return <div ref={viewportRef} />
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  width = 900
  height = 600
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private active = true
      constructor(callback: () => void) {
        notifyResize = () => {
          if (this.active) callback()
        }
      }
      observe() {}
      disconnect() {
        this.active = false
      }
    },
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function resize(nextWidth: number, nextHeight: number) {
  width = nextWidth
  height = nextHeight
  await act(async () => notifyResize())
}

describe('design canvas viewport', () => {
  it('fits both dimensions and refits when artwork or viewport changes', async () => {
    await act(async () => root.render(<Probe />))
    await resize(900, 600)
    expect(6 * 96 * controls.zoom + 104).toBeLessThanOrEqual(600)
    await act(async () => root.render(<Probe artboard={{ width: 40, height: 40 }} />))
    await resize(390, 350)
    expect(controls.zoom).toBeLessThan(0.1)
    expect(40 * 96 * controls.zoom + 104).toBeLessThanOrEqual(350)
    await resize(320, 122)
    expect(controls.zoom).toBeLessThan(0.01)
    expect(40 * 96 * controls.zoom + 104).toBeLessThanOrEqual(122)
    await act(async () => controls.zoomBy(1.2))
    expect(controls.zoom).toBeGreaterThan(0.0046)
    await act(async () => controls.fitToWindow())
    await resize(700, 600)
    expect(controls.zoom).toBeGreaterThan(0.1)
    expect(40 * 96 * controls.zoom + 104).toBeLessThanOrEqual(600)
  })

  it('keeps manual zoom on resize and resumes responsive fitting on demand', async () => {
    await act(async () => root.render(<Probe />))
    await resize(900, 600)
    await act(async () => controls.zoomTo(2))
    await resize(600, 400)
    expect(controls.zoom).toBe(2)
    await act(async () => controls.fitToWindow())
    expect(controls.fitMode).toBe(true)
    expect(6 * 96 * controls.zoom + 104).toBeLessThanOrEqual(400)
    await resize(700, 500)
    expect(6 * 96 * controls.zoom + 104).toBeLessThanOrEqual(500)
  })

  it('supports pinch zoom and Escape to exit fullscreen', async () => {
    await act(async () => root.render(<Probe />))
    await resize(900, 600)
    const fitZoom = controls.zoom
    const wheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true })
    await act(async () => container.firstElementChild!.dispatchEvent(wheel))
    expect(wheel.defaultPrevented).toBe(true)
    expect(controls.zoom).toBeGreaterThan(fitZoom)
    expect(controls.fitMode).toBe(false)
    await act(async () => controls.setFullscreen(true))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(controls.fullscreen).toBe(false)
  })
})
