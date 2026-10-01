// @vitest-environment jsdom
import { act, type ReactNode, type HTMLAttributes, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/generated', async () => {
  const { default: messages } = await import('../../../../packages/i18n/src/messages/en.json')
  return {
    GeneratedValue: ({ value }: { value: ReactNode }) => value,
    GeneratedText: ({ id }: { id: keyof typeof messages.Generated }) => messages.Generated[id],
    useGeneratedTranslations: () => (id: keyof typeof messages.Generated) => messages.Generated[id],
    useGeneratedValueTranslations: () => (value: string) => value,
  }
})
vi.mock('@/lib/picker-options', () => import('./picker-options'))
vi.mock('@/lib/list-params', () => import('./list-params'))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/components/remote-search-select', () => import('../components/remote-search-select'))
vi.mock('@/components/file-upload', () => ({ FileUpload: () => null }))
vi.mock('@/components/inspection-status-pill', () => ({ InspectionStatusPill: () => null }))
vi.mock('@beaconhs/ui', () => {
  const Block = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
    AlertDescription: Block,
    Badge: Block,
    Button: (props: ComponentProps<'button'>) => <button {...props} />,
    Input: (props: ComponentProps<'input'>) => <input {...props} />,
    Textarea: (props: ComponentProps<'textarea'>) => <textarea {...props} />,
    Label: (props: HTMLAttributes<HTMLLabelElement>) => <label {...props} />,
    UrlDrawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
      <>
        {children}
        {footer}
      </>
    ),
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
    SearchSelect: ({
      value,
      onChange,
      onSearchChange,
      options,
      ariaLabel,
      disabled,
      clearable,
      statusMessage,
    }: {
      value: string
      onChange: (value: string) => void
      onSearchChange: (value: string) => void
      options: { value: string; label: string }[]
      ariaLabel: string
      disabled: boolean
      clearable: boolean
      statusMessage?: string
    }) => (
      <div>
        <input
          aria-label={`Search ${ariaLabel}`}
          onChange={(event) => onSearchChange(event.target.value)}
          disabled={disabled}
        />
        <input type="hidden" aria-label={ariaLabel} value={value} />
        {clearable ? (
          <button type="button" disabled={disabled} onClick={() => onChange('')}>
            None
          </button>
        ) : null}
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
        {statusMessage}
      </div>
    ),
  }
})
const state = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('../app/(app)/equipment/inspections/_actions', () => ({
  startEquipmentInspection: state.start,
}))
import { PpeInspectionForm } from '../app/(app)/ppe/[id]/_inspection-form'
import { NewEquipmentInspectionDrawer } from '../app/(app)/equipment/inspections/_new-drawer'

let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>
async function change(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!
  const prototype = HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251)
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  fetchMock = vi.fn(async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams
    return {
      ok: true,
      json: async () => ({
        options:
          params.get('q') === 'Zebra' ? [{ value: 'zebra-type', label: 'Zebra rental check' }] : [],
        hasMore: params.get('q') !== 'Zebra',
      }),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  state.start.mockReset()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('inspection creation', () => {
  it('loads supervisors with the inspection capability and keeps PPE answers and notes after failure', async () => {
    const action = vi.fn(async (_data: FormData) => ({
      error: 'Inspection cannot be recorded yet',
    }))
    await act(async () =>
      root.render(
        <PpeInspectionForm
          open
          closeHref="/ppe/item"
          title="Inspect"
          itemId="item"
          typeId="type"
          kind="pre_use"
          criteria={[
            {
              id: 'criterion',
              question: 'Safe?',
              description: null,
              severity: 'low',
              requiresPhoto: false,
            },
          ]}
          action={action}
        />,
      ),
    )
    await tick()
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          new URL(url, 'http://localhost').searchParams.get('lookup') ===
          'ppe-inspection-supervisors',
      ),
    ).toBe(true)
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type="radio"][value="pass"]')!.click(),
    )
    const notes = container.querySelector<HTMLInputElement>('input[name="notes"]')!
    notes.value = 'Keep these notes'
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    const data = action.mock.calls[0]![0] as unknown as FormData
    expect(data.get('supervisorPersonId')).toBe('')
    expect(data.get('criterion_criterion')).toBe('pass')
    expect(data.get('notes')).toBe('Keep these notes')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Inspection cannot be recorded yet',
    )
    expect(notes.value).toBe('Keep these notes')
    expect(container.querySelector<HTMLInputElement>('input[value="pass"]')!.checked).toBe(true)
  })

  it('searches rental inspection types remotely beyond the initial result page and preserves failed starts', async () => {
    state.start.mockRejectedValue(new Error('Network unavailable'))
    await act(async () => root.render(<NewEquipmentInspectionDrawer />))
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Rental / unregistered')!
        .click(),
    )
    await change('#rentalName', 'Rental crane')
    await tick()
    expect(container.textContent).toContain('More results exist. Refine your search.')
    await change('input[aria-label="Search Inspection type"]', 'Zebra')
    await tick()
    expect(
      fetchMock.mock.calls.some(([url]) => {
        const params = new URL(url, 'http://localhost').searchParams
        return (
          params.get('lookup') === 'equipment-rental-inspection-types' &&
          params.get('q') === 'Zebra' &&
          !params.has('contextId')
        )
      }),
    ).toBe(true)
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Zebra rental check')!
        .click(),
    )
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Start inspection')!
        .click(),
    )
    expect(state.start).toHaveBeenCalledTimes(1)
    const data = state.start.mock.calls[0]![0] as FormData
    expect(data.get('targetMode')).toBe('rental')
    expect(data.get('typeId')).toBe('zebra-type')
    expect(data.get('rentalName')).toBe('Rental crane')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Your entries are kept',
    )
    expect(container.querySelector<HTMLInputElement>('#rentalName')!.value).toBe('Rental crane')
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Registered unit')!
        .click(),
    )
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Inspection type"]')!.value,
    ).toBe('')
  })
})
