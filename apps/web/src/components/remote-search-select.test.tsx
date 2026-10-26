// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/i18n/generated', () => ({
  useGeneratedValueTranslations: () => (value: string) => value,
}))
vi.mock('@/lib/picker-options', async (original) => ({
  ...(await original<typeof import('@/lib/picker-options')>()),
  fetchPickerOptions: mocks.fetch,
}))
vi.mock('@beaconhs/ui', () => ({
  SearchSelect: ({
    value,
    options,
    disabled,
  }: {
    value: string
    options: { value: string; label: string }[]
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled}>
      {options.find((option) => option.value === value)?.label ?? 'None'}
    </button>
  ),
}))
import { RemoteSearchSelect } from './remote-search-select'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  mocks.fetch.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function render(props: Partial<Parameters<typeof RemoteSearchSelect>[0]>) {
  await act(async () =>
    root.render(
      <RemoteSearchSelect
        lookup="journal-supervisors"
        value="person-1"
        onChange={() => {}}
        disabled
        {...props}
      />,
    ),
  )
  await act(async () => vi.runAllTimersAsync())
}

describe('RemoteSearchSelect when disabled', () => {
  it('still resolves the saved choice so a locked record shows its name', async () => {
    mocks.fetch.mockResolvedValue({
      options: [{ value: 'person-1', label: 'Jacob Kolomaya' }],
      hasMore: false,
    })
    await render({})
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ lookup: 'journal-supervisors', query: '', selected: 'person-1' }),
      expect.anything(),
    )
    expect(container.textContent).toBe('Jacob Kolomaya')
  })

  it('uses a supplied label without a lookup', async () => {
    await render({ initialOption: { value: 'person-1', label: 'Jacob Kolomaya' } })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(container.textContent).toBe('Jacob Kolomaya')
  })

  it('does not search when there is nothing to show', async () => {
    await render({ value: '' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
