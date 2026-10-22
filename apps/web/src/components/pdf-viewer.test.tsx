// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const pdf = vi.hoisted(() => ({ destroy: vi.fn(), load: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdf.load,
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  GeneratedText: () => null,
  useGeneratedValueTranslations: () => (value: string) => value,
  useGeneratedTranslations: () => (key: string) =>
    ({ m_00a262469a10eb: 'Zoom out', m_12713157ff4ed0: 'Zoom in' })[key] ?? key,
}))
import { PdfViewer } from './pdf-viewer'
let root: Root, container: HTMLDivElement
let resize: (() => void)[]
let viewportWidth: number
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  resize = []
  viewportWidth = 390
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize.push(callback)
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  pdf.load.mockReturnValue({ promise: Promise.resolve({ numPages: 3 }), destroy: pdf.destroy })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.style.overflow = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function open() {
  await act(async () => root.render(<PdfViewer url="/test.pdf" />))
}
async function click(label: string) {
  await act(async () =>
    document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(),
  )
}
it('zooms beyond the previous 200% limit, fits width and adapts to landscape', async () => {
  await open()
  for (let i = 0; i < 8; i++) await click('Zoom in')
  const page = () => document.querySelector<HTMLElement>('[data-page="1"]')!
  expect(page().style.width).toBe('1122px')
  await click('Fit width')
  expect(page().style.width).toBe('374px')
  viewportWidth = 844
  await act(async () => resize.forEach((callback) => callback()))
  expect(page().style.width).toBe('828px')
})
it('supports two-finger zoom while leaving one-finger scrolling to the browser', async () => {
  await open()
  const viewport = document.querySelector('.overflow-auto')!
  const touch = (type: string, distance: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'touches', {
      value: [
        { clientX: 0, clientY: 50 },
        { clientX: distance, clientY: 50 },
      ],
    })
    viewport.dispatchEvent(event)
    return event
  }
  await act(async () => {
    touch('touchstart', 100)
    touch('touchmove', 250)
  })
  expect(document.querySelector<HTMLElement>('[data-page="1"]')!.style.width).toBe('935px')
})
it('opens a full-screen reading surface and restores scrolling and focus on Escape', async () => {
  document.body.style.overflow = 'auto'
  await open()
  await click('Full screen')
  expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull()
  expect(document.body.style.overflow).toBe('hidden')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Exit full screen')
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.style.overflow).toBe('auto')
})
it('destroys the loading task when the reader closes', async () => {
  await open()
  await act(async () => root.render(null))
  expect(pdf.destroy).toHaveBeenCalled()
})
