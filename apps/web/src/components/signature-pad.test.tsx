// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ load: vi.fn(), change: vi.fn() }))
vi.mock('@/lib/saved-signature-actions', () => ({ getMySavedSignatureCapture: mocks.load }))
vi.mock('@/i18n/generated', () => ({ GeneratedValue: ({ value }: { value: unknown }) => value }))
vi.mock('@beaconhs/ui', async (original) => ({
  ...(await original<typeof import('@beaconhs/ui')>()),
  SignaturePad: () => <div data-canvas />,
}))
import { SignaturePad } from './signature-pad'
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
async function render(
  props: { reuseOwnSignature?: boolean; value?: string | null; signerPersonId?: string } = {},
) {
  await act(async () => {
    root.render(<SignaturePad value={null} onChange={mocks.change} {...props} />)
    await Promise.resolve()
  })
}
it('does not request or reuse a signature for ordinary or customer pads', async () => {
  await render()
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.change).not.toHaveBeenCalled()
})
it('manual mode waits for an explicit button click', async () => {
  mocks.load.mockResolvedValue({ mode: 'manual', dataUrl: 'saved-ink' })
  await render({ reuseOwnSignature: true, signerPersonId: 'self' })
  expect(mocks.load).toHaveBeenCalledWith('self')
  expect(mocks.change).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith('saved-ink')
})
it('automatic mode applies once and does not reapply after clearing', async () => {
  mocks.load.mockResolvedValue({ mode: 'automatic', dataUrl: 'saved-ink' })
  await render({ reuseOwnSignature: true })
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith('saved-ink')
  await render({ reuseOwnSignature: true, value: 'saved-ink' })
  await render({ reuseOwnSignature: true, value: null })
  expect(mocks.change).toHaveBeenCalledTimes(1)
})
it('never replaces existing captured ink with a saved signature', async () => {
  mocks.load.mockResolvedValue({ mode: 'automatic', dataUrl: 'saved-ink' })
  await render({ reuseOwnSignature: true, value: 'newly-drawn' })
  expect(mocks.change).not.toHaveBeenCalled()
})
it('keeps drawing available when a saved signature cannot load', async () => {
  mocks.load.mockRejectedValue(new Error('storage unavailable'))
  await render({ reuseOwnSignature: true })
  expect(host.querySelector('[data-canvas]')).not.toBeNull()
  expect(host.querySelector('[role=alert]')).not.toBeNull()
  expect(mocks.change).not.toHaveBeenCalled()
})
it('never offers previously loaded personal ink after changing to another signer', async () => {
  mocks.load.mockResolvedValueOnce({ mode: 'manual', dataUrl: 'own-ink' })
  await render({ reuseOwnSignature: true, signerPersonId: 'self' })
  expect(host.querySelector('button')).not.toBeNull()
  mocks.load.mockImplementationOnce(() => new Promise(() => {}))
  await render({ reuseOwnSignature: true, signerPersonId: 'other' })
  expect(host.querySelector('button')).toBeNull()
  expect(mocks.change).not.toHaveBeenCalled()
})
it('does not replace a stroke started while the saved image is still loading', async () => {
  let finish!: (value: { mode: string; dataUrl: string }) => void
  mocks.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await render({ reuseOwnSignature: true })
  await act(async () =>
    host.querySelector('[data-canvas]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })),
  )
  await act(async () => finish({ mode: 'automatic', dataUrl: 'late-ink' }))
  expect(mocks.change).not.toHaveBeenCalled()
})
