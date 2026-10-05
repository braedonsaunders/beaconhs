// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  flush: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/lib/confirm', () => ({ confirmDialog: mocks.confirm }))
vi.mock('@/lib/pending-record-saves', () => ({ flushRecordSaves: mocks.flush }))
vi.mock('../_actions/people', () => ({ deletePerson: mocks.remove }))
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: mocks.error } }))
vi.mock('@/i18n/generated', () => ({
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { DeletePersonButton } from './_delete-person-button'

let root: Root
let container: HTMLDivElement
async function render(element: React.ReactNode) {
  await act(async () => root.render(element))
}
function button() {
  return container.querySelector('button')!
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  mocks.flush.mockResolvedValue(undefined)
  mocks.remove.mockResolvedValue({ ok: true })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
const click = async () => {
  await act(async () => button().click())
}

describe('Delete person control', () => {
  it('disables deletion with an explanation for synced identities', async () => {
    await render(<DeletePersonButton id="person" synced />)
    const control = button()
    expect(control.disabled).toBe(true)
    expect(control.title).toContain('source system')
    await click()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('keeps the person when confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValue(false)
    await render(<DeletePersonButton id="person" synced={false} />)
    await click()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })
  it('waits for pending edits before deleting and returning to People', async () => {
    let finish!: () => void
    mocks.flush.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    await render(<DeletePersonButton id="person" synced={false} />)
    await click()
    expect(mocks.remove).not.toHaveBeenCalled()
    await act(async () => finish())
    expect(mocks.remove).toHaveBeenCalledWith('person')
    expect(mocks.push).toHaveBeenCalledWith('/people')
    expect(mocks.error).not.toHaveBeenCalled()
  })
  it('retains the page and shows a server-side ownership error', async () => {
    mocks.remove.mockResolvedValue({ ok: false, error: 'Managed by sync' })
    await render(<DeletePersonButton id="person" synced={false} />)
    await click()
    expect(mocks.error).toHaveBeenCalledWith('Managed by sync')
    expect(mocks.push).not.toHaveBeenCalled()
  })
  it('blocks deletion when an edit cannot save', async () => {
    mocks.flush.mockRejectedValue(new Error('Save failed'))
    await render(<DeletePersonButton id="person" synced={false} />)
    await click()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('Save failed')
  })
})
