// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  request: vi.fn(),
  collect: vi.fn(),
  ink: null as null | ((value: string | null) => void),
  sign: vi.fn(),
  clear: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('./_signing-actions', () => ({
  addSigningCrew: mocks.add,
  requestCrewSignatures: mocks.request,
  startSigningCollection: mocks.collect,
  signCrewMember: mocks.sign,
  clearCrewSignature: mocks.clear,
  removeSigningCrew: mocks.remove,
}))
vi.mock('@/lib/confirm', () => ({ confirmDialog: mocks.confirm }))
vi.mock('@/lib/pending-record-saves', () => ({ flushRecordSaves: async () => {} }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  unstable_rethrow: vi.fn(),
}))
vi.mock('@/components/pagination', () => ({ Pagination: () => null }))
vi.mock('@/components/raw-image', () => ({
  RawImage: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))
vi.mock('@/components/signature-pad', () => ({
  SignaturePad: ({ onChange }: { onChange: typeof mocks.ink }) => {
    mocks.ink = onChange
    return <div data-signature-pad />
  },
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  useGeneratedValueTranslations: () => (s: string) => s,
}))
vi.mock('@beaconhs/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Input: ({
    ref,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) => (
    <input ref={ref} {...props} />
  ),
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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
  Drawer: ({
    title,
    children,
    footer,
  }: {
    title: ReactNode
    children: ReactNode
    footer: ReactNode
  }) => (
    <div role="dialog">
      {title}
      {children}
      {footer}
    </div>
  ),
}))
import { SigningRoster } from './_signing-roster'
import type { SigningRosterData } from '@/lib/hazid-signing-roster'
let root: Root, container: HTMLDivElement, roster: SigningRosterData
const persons = Array.from({ length: 20 }, (_, i) => ({
  value: `person:${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000001`,
  label: `Worker ${String(i + 1).padStart(2, '0')}`,
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  roster = {
    rows: [],
    total: 0,
    crewTotal: 0,
    signed: 0,
    revision: 1,
    locked: false,
    page: 1,
    perPage: 25,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/picker-options')) {
        const q = new URL(url, 'http://localhost').searchParams.get('q') ?? ''
        return {
          ok: true,
          json: async () => ({
            options: persons.filter(
              (p) => p.label.includes(q) && !roster.rows.some((r) => r.id === p.value.slice(7)),
            ),
            hasMore: false,
          }),
        }
      }
      return { ok: true, json: async () => structuredClone(roster) }
    }),
  )
  mocks.add.mockImplementation(async ({ personIds }: { personIds: string[] }) => {
    for (const id of personIds) {
      const person = persons.find((p) => p.value === `person:${id}`)!
      roster.rows.push({
        id,
        name: person.label,
        signedAt: null,
        image: null,
        requestedAt: null,
        expiresAt: null,
        remoteAvailable: true,
        active: true,
      })
    }
    roster.total = roster.crewTotal = roster.rows.length
    return { ok: true, data: personIds.length }
  })
  mocks.collect.mockImplementation(async () => ({
    ok: true,
    data: {
      revision: 1,
      signers: roster.rows.filter((r) => !r.signedAt).map((r) => ({ id: r.id, name: r.name })),
    },
  }))
  mocks.request.mockResolvedValue({ ok: true, data: { requested: 20, skipped: 0, withoutPush: 0 } })
  mocks.sign.mockResolvedValue({ ok: true })
  mocks.confirm.mockResolvedValue(true)
  mocks.clear.mockImplementation(async ({ signatureId }: { signatureId: string }) => {
    const row = roster.rows.find((r) => r.id === signatureId)!
    row.image = row.signedAt = null
    roster.signed--
    return { ok: true }
  })
  mocks.remove.mockImplementation(async ({ signatureId }: { signatureId: string }) => {
    roster.rows = roster.rows.filter((r) => r.id !== signatureId)
    roster.total = roster.crewTotal = roster.rows.length
    roster.signed = roster.rows.filter((r) => r.signedAt).length
    return { ok: true }
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function render(canUpdate = true) {
  await act(async () =>
    root.render(
      <SigningRoster
        assessmentId="10000000-0000-4000-8000-000000000001"
        initial={structuredClone(roster)}
        canUpdate={canUpdate}
      />,
    ),
  )
}
async function search(q: string) {
  await act(async () => {
    const input = container.querySelector('input')!
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, q)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(160)
  })
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text)!
}
it('adds twenty people without a form, confirmation or navigation, and keeps the input ready', async () => {
  await render()
  for (const person of persons) {
    await search(person.label)
    await act(async () => button(person.label).click())
    expect(container.querySelector('input')!.value).toBe('')
    expect(document.activeElement).toBe(container.querySelector('input'))
  }
  expect(mocks.add).toHaveBeenCalledTimes(20)
  expect(container.querySelectorAll('button').length).toBeGreaterThan(20)
  expect(container.textContent).toContain('Signed 0/20')
  expect(container.querySelector('select')).toBeNull()
  expect(container.querySelector('[role=dialog]')).toBeNull()
  expect(button('Sign').parentElement!.className).toContain('grid-cols-2')
  expect(button('Request').parentElement).toBe(button('Sign').parentElement)
})
it('opens only a signature drawer and keeps Request as the short manual-send button', async () => {
  await render()
  await search(persons[0]!.label)
  await act(async () => button(persons[0]!.label).click())
  await act(async () => button('Sign').click())
  const drawer = container.querySelector('[role=dialog]')!
  expect(drawer.textContent).toContain('Worker 01')
  expect(drawer.querySelector('[data-signature-pad]')).not.toBeNull()
  expect(drawer.querySelector('input[type=checkbox]')).toBeNull()
  expect(drawer.textContent).not.toContain('Review')
  await act(async () => {
    mocks.ink!('data:image/png;base64,test')
  })
  await act(async () => button('Done').click())
  expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(
    roster.rows[0]!.id,
    1,
    'data:image/png;base64,test',
  )
  expect(container.querySelector('[role=dialog]')).toBeNull()
  await act(async () => button('Request').click())
  expect(mocks.request).toHaveBeenCalledTimes(1)
})
it('shows a waiting box before the add finishes, then removes it on failure with a visible error', async () => {
  let finish!: (r: unknown) => void
  mocks.add.mockReturnValueOnce(
    new Promise((r) => {
      finish = r
    }),
  )
  await render()
  await search(persons[0]!.label)
  await act(async () => button(persons[0]!.label).click())
  expect(container.textContent).toContain('Worker 01Awaiting signature')
  expect(button('Sign').disabled).toBe(true)
  await act(async () => finish({ ok: false, error: 'Could not add person' }))
  expect(container.querySelector('[role=alert]')!.textContent).toBe('Could not add person')
  expect(container.textContent).not.toContain('Worker 01Awaiting signature')
})

it('adds crew and allows Sign and Request while the job content is locked', async () => {
  roster.locked = true
  await render()
  await search(persons[0]!.label)
  await act(async () => button(persons[0]!.label).click())
  await act(async () => button('Request').click())
  expect(mocks.request).toHaveBeenCalledTimes(1)
  await act(async () => button('Sign').click())
  expect(container.querySelector('[data-signature-pad]')).not.toBeNull()
  expect(mocks.collect).toHaveBeenCalledTimes(1)
})
async function signedCrew() {
  await mocks.add({ personIds: [persons[0]!.value.slice(7), persons[1]!.value.slice(7)] })
  for (const row of roster.rows) {
    row.image = '/signature.png'
    row.signedAt = '2026-10-08T12:00:00.000Z'
  }
  roster.signed = 2
  roster.locked = true
}
it('keeps saved ink read-only and clears only the selected signer before allowing new ink', async () => {
  await signedCrew()
  await render()
  expect(button('Sign').disabled).toBe(true)
  expect(container.querySelector('[data-signature-pad]')).toBeNull()
  await act(async () => button('Clear').click())
  expect(mocks.clear).toHaveBeenCalledExactlyOnceWith({
    assessmentId: '10000000-0000-4000-8000-000000000001',
    signatureId: persons[0]!.value.slice(7),
    revision: 1,
    signedAt: '2026-10-08T12:00:00.000Z',
  })
  expect(roster.rows[1]!.signedAt).not.toBeNull()
  expect(container.textContent).toContain('Signed 1/2')
  await act(async () => button('Awaiting signature').click())
  expect(container.querySelector('[data-signature-pad]')).not.toBeNull()
})
it('removes a signed crew slot after confirmation without clearing the other signatures', async () => {
  await signedCrew()
  await render()
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Remove"]')!.click(),
  )
  expect(mocks.confirm).toHaveBeenCalledTimes(1)
  expect(mocks.remove).toHaveBeenCalledWith(
    expect.objectContaining({
      signatureId: persons[0]!.value.slice(7),
      revision: 1,
      signedAt: '2026-10-08T12:00:00.000Z',
    }),
  )
  expect(roster.rows).toHaveLength(1)
  expect(roster.rows[0]!.signedAt).not.toBeNull()
})
it('does not expose signature mutations to readers', async () => {
  await signedCrew()
  await render(false)
  expect(container.querySelector('input')).toBeNull()
  expect(container.querySelector('button[aria-label="Remove"]')).toBeNull()
  expect(button('Clear')).toBeUndefined()
  expect(button('Sign')).toBeUndefined()
  expect(button('Request')).toBeUndefined()
})
