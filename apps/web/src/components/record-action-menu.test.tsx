// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('@/lib/confirm', () => ({ confirmDialog: mocks.confirm }))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { RecordActionMenu } from './record-action-menu'
import { ConfirmButton } from './confirm-button'
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
describe('record action menu', () => {
  it('shows one named trigger, focuses its actions, and puts deletion last', async () => {
    await act(async () =>
      root.render(
        <RecordActionMenu destructive={<button type="button">Delete</button>}>
          <a href="/pdf">PDF</a>
          <button type="button">New work order</button>
        </RecordActionMenu>,
      ),
    )
    const trigger = container.querySelector('button')!
    expect(trigger.textContent).toBe('Actions')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await act(async () => trigger.click())
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-label')).toBe('Record actions')
    expect([...dialog.querySelectorAll('a,button')].map((node) => node.textContent)).toEqual([
      'PDF',
      'New work order',
      'Delete',
    ])
    expect(document.activeElement?.textContent).toBe('PDF')
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })
  it('keeps a confirmation form connected when the menu closes before confirmation finishes', async () => {
    let confirm!: (ok: boolean) => void
    mocks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          confirm = resolve
        }),
    )
    const remove = vi.fn(async (_form: FormData) => {})
    await act(async () =>
      root.render(
        <RecordActionMenu
          destructive={
            <form action={remove}>
              <input type="hidden" name="id" value="equipment-id" />
              <ConfirmButton message="Delete this equipment?">Delete</ConfirmButton>
            </form>
          }
        >
          <a href="/pdf">PDF</a>
        </RecordActionMenu>,
      ),
    )
    const trigger = container.querySelector('button')!
    await act(async () => trigger.click())
    const form = document.body.querySelector('form')!
    await act(async () => form.querySelector('button')!.click())
    await act(async () => trigger.click())
    expect(form.isConnected).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    await act(async () => confirm(true))
    expect(remove).toHaveBeenCalledOnce()
    expect(remove.mock.calls[0]?.[0].get('id')).toBe('equipment-id')
  })
})
