// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { CrewSearch } from './_signature-form'
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('offers an explicit external worker drawer, requires a name, and retains the company in the crew identity', async () => {
  const add = vi.fn()
  await act(async () =>
    root.render(<CrewSearch assessmentId="test" onAdd={add} pendingValues={[]} />),
  )
  const button = (text: string) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === text)!
  await act(async () => button('Add external worker').click())
  expect(button('Add to crew').disabled).toBe(true)
  const fields = document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')
  async function input(el: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await input(fields[0]!, '  Visitor QA  ')
  await input(fields[1]!, 'Other employer')
  await act(async () => button('Add to crew').click())
  expect(add).toHaveBeenCalledWith({
    value: 'external:Visitor QA (Other employer)',
    label: 'Visitor QA (Other employer)',
    hint: 'Visitor',
  })
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})
