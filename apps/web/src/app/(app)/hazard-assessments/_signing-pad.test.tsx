// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  crew: vi.fn(),
  own: vi.fn(),
  ink: null as null | ((ink: string | null) => void),
}))
vi.mock('./_signing-actions', () => ({ signCrewMember: mocks.crew, signOwnAssessment: mocks.own }))
vi.mock('@/lib/actions', () => ({ setActiveTenant: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}))
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/signature-pad', () => ({
  SignaturePad: ({ onChange }: { onChange: typeof mocks.ink }) => {
    mocks.ink = onChange
    return null
  },
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
vi.mock('@beaconhs/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SearchSelect: () => null,
}))
import { SigningPad } from './_signing-pad'

let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  mocks.crew.mockResolvedValue({ ok: true })
  mocks.own.mockResolvedValue({ ok: true })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(own = false) {
  await act(async () =>
    root.render(
      <SigningPad
        assessmentId="assessment"
        revision={3}
        own={own}
        signers={
          own
            ? [{ id: 'one', name: 'Person One' }]
            : [
                { id: 'one', name: 'Person One' },
                { id: 'two', name: 'Person Two' },
              ]
        }
        review={<p>Exact frozen job content</p>}
      />,
    ),
  )
}
function saveButton() {
  return [...container.querySelectorAll('button')].find((b) =>
    /Save & next|Save signature/.test(b.textContent ?? ''),
  )!
}
async function prepare() {
  await act(async () => {
    const check = container.querySelector<HTMLInputElement>('input[type=checkbox]')!
    check.click()
    mocks.ink!('data:image/png;base64,test')
  })
}

describe('continuous crew signing', () => {
  it('requires review and ink, saves once, then advances with fresh fields', async () => {
    await render()
    expect(saveButton().disabled).toBe(true)
    await prepare()
    expect(saveButton().disabled).toBe(false)
    await act(async () => saveButton().click())
    expect(mocks.crew).toHaveBeenCalledExactlyOnceWith('one', 3, 'data:image/png;base64,test', true)
    expect(container.textContent).toContain('Person Two')
    expect(container.textContent).toContain('1 saved')
    expect(saveButton().disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
    await prepare()
    await act(async () => saveButton().click())
    expect(mocks.crew).toHaveBeenLastCalledWith('two', 3, 'data:image/png;base64,test', true)
    expect(container.textContent).toContain('Crew signatures saved')
  })
  it('keeps the current person and ink on a rejected save so retry cannot skip them', async () => {
    mocks.crew.mockResolvedValueOnce({ ok: false, error: 'Assessment changed' })
    await render()
    await prepare()
    await act(async () => saveButton().click())
    expect(container.querySelector('[role=alert]')?.textContent).toBe('Assessment changed')
    expect(container.textContent).toContain('Person One')
    expect(saveButton().disabled).toBe(false)
    await act(async () => saveButton().click())
    expect(mocks.crew).toHaveBeenCalledTimes(2)
    expect(mocks.crew).toHaveBeenLastCalledWith('one', 3, 'data:image/png;base64,test', true)
    expect(container.textContent).toContain('Person Two')
  })
  it('uses the own-person action on a phone request, without manager permissions', async () => {
    await render(true)
    await prepare()
    await act(async () => saveButton().click())
    expect(mocks.own).toHaveBeenCalledExactlyOnceWith('one', 3, 'data:image/png;base64,test', true)
    expect(mocks.crew).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Your signature is saved')
  })
  it('does not accept a second tap while the persisted save is in flight', async () => {
    let finish!: (result: { ok: true }) => void
    mocks.crew.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await render()
    await prepare()
    await act(async () => saveButton().click())
    expect(container.querySelector('button:last-child')?.textContent).toContain('Saving')
    expect(mocks.crew).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: true }))
    expect(container.textContent).toContain('Person Two')
  })
})
