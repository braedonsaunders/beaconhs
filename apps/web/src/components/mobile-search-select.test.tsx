// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SearchSelect } from '../../../../packages/ui/src/search-select'
import { Drawer } from '../../../../packages/ui/src/drawer'
import { Popover } from '../../../../packages/ui/src/popover'

let root: Root, container: HTMLDivElement
let viewport: EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  viewport = Object.assign(new EventTarget(), {
    height: 800,
    width: 390,
    offsetTop: 0,
    offsetLeft: 0,
  })
  vi.stubGlobal('visualViewport', viewport)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function input(text: string) {
  const search = document.querySelector<HTMLInputElement>('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, text)
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('searches displayed employee/job numbers and resets the results scroll without changing the selection', async () => {
  const change = vi.fn()
  await act(async () =>
    root.render(
      <SearchSelect
        value="worker"
        onChange={change}
        searchable
        options={[
          { value: 'worker', label: 'Worker Example', hint: 'EMP-4271' },
          { value: 'job', label: 'Platform maintenance', hint: 'JOB-8829' },
        ]}
      />,
    ),
  )
  await act(async () => container.querySelector('button')!.click())
  const list = document.querySelector('[role="listbox"]')!.parentElement!
  list.scrollTop = 300
  await input('8829')
  expect(document.querySelector('[role="listbox"]')!.textContent).toContain('Platform maintenance')
  expect(document.querySelector('[role="listbox"]')!.textContent).not.toContain('Worker Example')
  expect(list.scrollTop).toBe(0)
  expect(change).not.toHaveBeenCalled()
  await input('4271')
  expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain('Worker Example')
})
it('keeps the entire mobile sheet inside the visible screen as the keyboard opens and closes', async () => {
  await act(async () =>
    root.render(
      <SearchSelect
        value=""
        onChange={() => {}}
        searchable
        options={[{ value: 'job', label: 'Job' }]}
      />,
    ),
  )
  await act(async () => container.querySelector('button')!.click())
  expect(document.querySelector('[role="dialog"] input')).not.toBeNull()
  const overlay = document.querySelector('[role="dialog"]')!.parentElement as HTMLElement
  expect(overlay.style.height).toBe('800px')
  await act(async () => {
    viewport.height = 360
    viewport.offsetTop = 70
    viewport.dispatchEvent(new Event('resize'))
  })
  expect(overlay.style.height).toBe('360px')
  expect(overlay.style.top).toBe('70px')
  expect(document.querySelector('[role="option"]')?.textContent).toContain('Job')
  await act(async () => {
    viewport.height = 800
    viewport.offsetTop = 0
    viewport.dispatchEvent(new Event('resize'))
  })
  expect(overlay.style.height).toBe('800px')
})
it('flips crew-search results above a low input and bounds them to the keyboard-visible viewport', async () => {
  viewport.height = 360
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 16,
    y: 270,
    top: 270,
    left: 16,
    right: 374,
    bottom: 314,
    width: 358,
    height: 44,
    toJSON() {},
  })
  await act(async () =>
    root.render(
      <Popover
        open
        onOpenChange={() => {}}
        align="start"
        matchTriggerWidth
        trigger={<input aria-label="Crew" />}
      >
        <div>Matching crew</div>
      </Popover>,
    ),
  )
  const panel = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(panel.style.top).toBe('')
  expect(panel.style.bottom).not.toBe('')
  expect(Number.parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(360)
  expect(panel.className).toContain('z-[80]')
})

it('closing a picker with Escape restores focus and leaves its assessment drawer open', async () => {
  const close = vi.fn()
  await act(async () =>
    root.render(
      <Drawer open onClose={close} title="Assessment">
        <SearchSelect
          value=""
          onChange={() => {}}
          searchable
          sheetTitle="Select a job"
          options={[{ value: 'job', label: 'Job' }]}
        />
      </Drawer>,
    ),
  )
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.includes('Select…'),
  )!
  await act(async () => trigger.click())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80))
  })
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Search…')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  )
  expect(close).not.toHaveBeenCalled()
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
})
