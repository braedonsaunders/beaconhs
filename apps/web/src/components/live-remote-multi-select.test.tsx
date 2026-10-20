// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ field: vi.fn(), commit: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/offline-drafts/offline-record', () => ({ useRecordField: mocks.field }))
vi.mock('@beaconhs/ui/rich-text-editor', () => ({ RichTextEditor: () => null }))
vi.mock('./remote-multi-select', () => ({
  RemoteMultiSelect: ({ value }: { value: { value: string; label: string }[] }) => (
    <ul>
      {value.map((option) => (
        <li key={option.value}>{option.label}</li>
      ))}
    </ul>
  ),
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { LiveRemoteMultiSelect } from './live-field'
const saved = 'd6048130-b199-4c6c-a178-9ab4c9cb51c9'
const restored = '48601141-8b19-4673-8276-ef38b7b375db'
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.field.mockReturnValue({
    value: [saved, restored],
    saveState: 'idle',
    paused: false,
    error: null,
    retry: vi.fn(),
    commit: mocks.commit,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render() {
  await act(async () => {
    root.render(
      <LiveRemoteMultiSelect
        field="foremanPersonIds"
        label="Foreman"
        lookup="inspection-people"
        initialValue={[saved]}
        initialOptions={[{ value: saved, label: 'Alex Foreman' }]}
      />,
    )
  })
}
function response() {
  return {
    ok: true,
    json: async () => ({ options: [{ value: restored, label: 'Blair Foreman' }], hasMore: false }),
  }
}
it('hydrates a recovered selection absent from the server snapshot by its selected id', async () => {
  mocks.fetch.mockResolvedValue(response())
  await render()
  expect(container.textContent).toContain('Alex Foreman')
  expect(container.textContent).toContain('Blair Foreman')
  expect(container.textContent).not.toContain('Selected person')
  expect(mocks.fetch).toHaveBeenCalledWith(
    expect.stringContaining(`selected=${restored}`),
    expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }),
  )
  expect(mocks.commit).not.toHaveBeenCalled()
})
it('keeps recovered selections through a lookup failure and recovers their names when signal returns', async () => {
  mocks.fetch.mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValue(response())
  await render()
  expect(container.textContent).toContain('Selected person')
  expect(container.textContent).toContain('Reconnect and tap to retry.')
  expect(container.querySelectorAll('li')).toHaveLength(2)
  await act(async () => window.dispatchEvent(new Event('online')))
  expect(container.textContent).toContain('Blair Foreman')
  expect(container.textContent).not.toContain('Reconnect and tap to retry.')
  expect(mocks.commit).not.toHaveBeenCalled()
})
it('recovers available labels even when another selected person cannot be resolved', async () => {
  const missing = 'f7f33672-7511-40c8-b775-f08fdc46e9a7'
  mocks.field.mockReturnValue({
    value: [saved, restored, missing],
    saveState: 'idle',
    paused: false,
    error: null,
    retry: vi.fn(),
    commit: mocks.commit,
  })
  mocks.fetch.mockImplementation(async (url: string) =>
    url.includes(restored)
      ? response()
      : { ok: true, json: async () => ({ options: [], hasMore: false }) },
  )
  await render()
  expect(container.textContent).toContain('Blair Foreman')
  expect(container.textContent).toContain('Selected person')
  expect(container.textContent).toContain('Reconnect and tap to retry.')
  expect(container.querySelectorAll('li')).toHaveLength(3)
  expect(mocks.commit).not.toHaveBeenCalled()
})
