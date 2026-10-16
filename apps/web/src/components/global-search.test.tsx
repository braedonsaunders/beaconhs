// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { GlobalSearch } from './global-search'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/i18n/generated', () => ({
  GeneratedText: () => null,
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedTranslations: () => (key: string) => key,
}))

it('keeps forwarded canvas typing in the editor while retaining the page search shortcut', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<GlobalSearch />))
    const search = host.querySelector('input')!
    const frame = document.createElement('iframe')
    host.append(frame)
    frame.focus()
    const forwarded = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    act(() => frame.dispatchEvent(forwarded))
    expect(forwarded.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(frame)
    const pageShortcut = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    act(() => document.body.dispatchEvent(pageShortcut))
    expect(pageShortcut.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(search)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
