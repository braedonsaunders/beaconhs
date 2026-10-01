// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowSubjectProfile } from '@beaconhs/forms-core'
import { MODULE_FLOW_PROFILES } from '@/lib/flows/module-profiles'
import { FlowFieldReference } from './flow-field-reference'

vi.mock('@/i18n/generated', () => ({ useGeneratedValueTranslations: () => (text: string) => text }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@beaconhs/ui', async (importOriginal) => {
  const ui = await importOriginal<typeof import('@beaconhs/ui')>()
  return {
    ...ui,
    Popover: ({
      trigger,
      children,
      open,
    }: {
      trigger: ReactNode
      children: ReactNode
      open: boolean
    }) => (
      <>
        {trigger}
        {open ? children : null}
      </>
    ),
  }
})
let root: Root
let container: HTMLDivElement
const writeText = vi.fn(async (_token: string) => {})
async function render(profile: FlowSubjectProfile) {
  await act(async () => root.render(<FlowFieldReference profile={profile} />))
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
}
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })))
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  writeText.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
describe('shared flow field reference', () => {
  it('finds and copies the real hazard-assessment subject markers and closes without closing its parent', async () => {
    await render(MODULE_FLOW_PROFILES.hazid!)
    expect(container.querySelectorAll('li')).toHaveLength(8)
    await search('project_name')
    expect(container.querySelector('code')!.textContent).toBe('{{project_name}}')
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label^="Copy field marker"]')!
        .click(),
    )
    expect(writeText).toHaveBeenCalledExactlyOnceWith('{{project_name}}')
    await search('Occurred at')
    expect(container.querySelector('code')!.textContent).toBe('{{occurred_at}}')
    const parentEscape = vi.fn()
    container.addEventListener('keydown', parentEscape)
    await act(async () =>
      container
        .querySelector('input')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(parentEscape).not.toHaveBeenCalled()
    expect(container.querySelector('section')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('button'))
  })
  it('uses custom-app fields, paginates, filters types, and reports an empty search', async () => {
    await render({
      ...MODULE_FLOW_PROFILES.hazid!,
      subjectType: 'form_template',
      subjectKey: 'custom',
      label: 'Custom app',
      fields: Array.from({ length: 12 }, (_, index) => ({
        key: `f_36b0e26a-2cd7-427d-968d-fded4527bc${String(index).padStart(2, '0')}`,
        label: `Custom field ${index}`,
        kind: index === 11 ? 'date' : 'text',
      })),
    })
    expect(container.textContent).toContain('Custom app')
    expect(container.textContent).not.toContain('{{project_name}}')
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Next')!
        .click(),
    )
    expect(container.querySelectorAll('li')).toHaveLength(4)
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Date')!
        .click(),
    )
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.querySelector('code')!.textContent).toBe(
      '{{f_36b0e26a-2cd7-427d-968d-fded4527bc11}}',
    )
    await search('not a field')
    expect(container.textContent).toContain('No matching fields.')
  })
})
