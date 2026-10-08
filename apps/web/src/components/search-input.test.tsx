// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchInput } from './search-input'

const navigation = vi.hoisted(() => ({ search: '', replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/equipment',
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
vi.mock('@/i18n/generated', () => ({
  useGeneratedValueTranslations: () => (value: unknown) => value,
  useGeneratedTranslations: () => () => 'Clear search',
}))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers()
  navigation.search = ''
  navigation.replace.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})
const render = (node: ReactNode) => {
  act(() => root.render(node))
  return { rerender: (next: ReactNode) => act(() => root.render(next)) }
}
const input = () => container.querySelector('input')!
const change = (value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
const clear = () => act(() => container.querySelector('button')!.click())
const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('URL list search', () => {
  it('keeps new characters when an older search response arrives', async () => {
    const view = render(<SearchInput />)
    change('AB')
    await tick()
    expect(navigation.replace).toHaveBeenLastCalledWith('/equipment?q=AB', { scroll: false })
    change('AB123')
    navigation.search = 'q=AB'
    view.rerender(<SearchInput />)
    expect(input().value).toBe('AB123')
    await tick()
    expect(navigation.replace).toHaveBeenLastCalledWith('/equipment?q=AB123', { scroll: false })
    navigation.search = 'q=AB123'
    view.rerender(<SearchInput />)
    expect(input().value).toBe('AB123')
  })
  it('does not restore cleared text from a stale search response', async () => {
    navigation.search = 'q=truck'
    const view = render(<SearchInput />)
    change('truck12')
    await tick()
    clear()
    navigation.search = 'q=truck12'
    view.rerender(<SearchInput />)
    expect(input().value).toBe('')
    await tick()
    expect(navigation.replace).toHaveBeenLastCalledWith('/equipment', { scroll: false })
  })
  it('preserves deep-linked pages until editing and resets only its own page', async () => {
    navigation.search = 'crewQ=Peter&crewPage=4&page=7&status=active'
    const view = render(<SearchInput paramKey="crewQ" pageParamKey="crewPage" />)
    await tick()
    expect(navigation.replace).not.toHaveBeenCalled()
    change('Matt')
    await tick()
    const url = new URL(navigation.replace.mock.calls[0]![0], 'https://example.test')
    expect(url.searchParams.get('crewQ')).toBe('Matt')
    expect(url.searchParams.has('crewPage')).toBe(false)
    expect(url.searchParams.get('page')).toBe('7')
    expect(url.searchParams.get('status')).toBe('active')
    navigation.search = url.searchParams.toString()
    view.rerender(<SearchInput paramKey="crewQ" pageParamKey="crewPage" />)
    navigation.search = 'crewQ=Peter&crewPage=4&page=7&status=active'
    view.rerender(<SearchInput paramKey="crewQ" pageParamKey="crewPage" />)
    expect(input().value).toBe('Peter')
  })
})
