// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  fetch: vi.fn(),
  createUrl: vi.fn(),
  revokeUrl: vi.fn(),
  click: vi.fn(),
}))
vi.mock('./_qr-actions', () => ({ generateBulkQrSheet: mocks.generate }))
vi.mock('./_actions', () => ({
  bulkAssignEquipmentToHolder: vi.fn(),
  bulkExportEquipmentCsv: vi.fn(),
  bulkSetEquipmentStatus: vi.fn(),
  bulkTransferEquipmentToSite: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/remote-search-select', () => ({ RemoteSearchSelect: () => null }))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: unknown) => value,
}))
import { BulkEquipmentBar } from './_bulk-bar'

let container: HTMLDivElement
let root: Root
let onClear: () => void
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = mocks.createUrl
      static override revokeObjectURL = mocks.revokeUrl
    },
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(mocks.click)
  mocks.generate.mockResolvedValue({
    ok: true,
    href: '/equipment/qr/labels?token=abcdefghijk',
    count: 2,
  })
  mocks.fetch.mockResolvedValue(
    new Response(new Blob(['pdf']), { headers: { 'Content-Type': 'application/pdf' } }),
  )
  mocks.createUrl.mockReturnValue('blob:labels')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onClear = vi.fn()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function render(canCreateQr = true, selectedIds = ids) {
  await act(async () =>
    root.render(
      <BulkEquipmentBar
        selectedIds={selectedIds}
        onClear={onClear}
        canManage={false}
        canExport={false}
        canCreateQr={canCreateQr}
      />,
    ),
  )
}
async function createQr() {
  await act(async () => {
    const button = [...document.querySelectorAll('button')]
      .reverse()
      .find((b) => b.textContent?.trim() === 'Create QR codes')!
    button.click()
  })
}
describe('equipment list QR selection action', () => {
  it('downloads labels for selected equipment without navigating away or clearing the selection', async () => {
    await render()
    expect(document.querySelector('select')!.value).toBe('qr')
    await createQr()
    expect(mocks.generate).toHaveBeenCalledWith({ equipmentIds: ids })
    expect(mocks.fetch).toHaveBeenCalledWith('/equipment/qr/labels?token=abcdefghijk')
    expect(mocks.click).toHaveBeenCalledOnce()
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:labels')
    expect(onClear).not.toHaveBeenCalled()
  })
  it('shows a rejected batch and does not download anything', async () => {
    mocks.generate.mockResolvedValue({ ok: false, error: 'Equipment unavailable' })
    await render()
    await createQr()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Equipment unavailable')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.click).not.toHaveBeenCalled()
  })
  it('does not save an HTML login or error page as a PDF', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }),
    )
    await render()
    await createQr()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not create QR codes',
    )
    expect(mocks.click).not.toHaveBeenCalled()
  })
  it('offers QR creation only with permission and an equipment selection', async () => {
    await render(false)
    expect(document.querySelector('option[value="qr"]')).toBeNull()
    await render(true, [])
    expect(document.querySelector('select')).toBeNull()
  })
})
