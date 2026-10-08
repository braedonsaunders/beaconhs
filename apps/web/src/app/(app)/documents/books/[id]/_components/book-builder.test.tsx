// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../../../../../../../../packages/i18n/src/messages/en.json'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  refresh: vi.fn(),
  error: vi.fn(),
  reorder: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: mocks.error } }))
vi.mock('@/components/remote-search-select', () => ({ RemoteSearchSelect: () => null }))
vi.mock('../actions', () => ({
  publishBookAction: mocks.publish,
  unpublishBookAction: vi.fn(),
  addBookHeadingAction: vi.fn(),
  addDocumentsToBookAction: vi.fn(),
  removeBookItemAction: vi.fn(),
  renameBookHeadingAction: vi.fn(),
  reorderBookItemsAction: mocks.reorder,
}))
import { BookBuilder } from './book-builder'
import type { BookEntry } from './book-tree'
let root: Root
let container: HTMLDivElement
const entries: BookEntry[] = [1, 2].map((n) => ({
  itemId: `item-${n}`,
  kind: 'document',
  documentId: `doc-${n}`,
  title: `Policy ${n}`,
  status: 'published',
  pinnedVersion: null,
}))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(published = false, items = entries) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BookBuilder
          bookId="book"
          title="Handbook"
          subtitle=""
          published={published}
          entries={items}
          settingsSlot={null}
          coverSlot={null}
          printSlot={null}
          activitySlot={null}
        />
      </NextIntlClientProvider>,
    ),
  )
}
describe('document book publication UI', () => {
  it('shows a named validation failure without losing the draft or refreshing into an error', async () => {
    mocks.publish.mockResolvedValue({
      ok: false,
      error: '"Overtime" is not a live published document.',
    })
    await render()
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Publish book'),
    )!
    await act(async () => button.click())
    expect(mocks.error).toHaveBeenCalledWith('"Overtime" is not a live published document.')
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Policy 1')
    expect(button.disabled).toBe(false)
  })
  it('refreshes pinned versions after an optimistic reorder and a successful publication', async () => {
    mocks.publish.mockResolvedValue({ ok: true })
    await render()
    await act(async () =>
      (container.querySelector('button[title="Move down"]') as HTMLButtonElement).click(),
    )
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Publish book'),
    )!
    expect(button.disabled).toBe(true)
    await act(async () => button.click())
    expect(mocks.publish).not.toHaveBeenCalled()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)))
    expect(mocks.reorder).toHaveBeenCalledWith('book', ['item-2', 'item-1'])
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(mocks.refresh).toHaveBeenCalledOnce()
    await render(
      true,
      [...entries].reverse().map((entry) => ({ ...entry, pinnedVersion: 7 })),
    )
    expect(container.textContent).not.toContain('Version unavailable')
    expect(container.textContent).toContain('7')
    expect(container.textContent).toContain('Unpublish')
  })
  it('restores the saved order when reordering fails instead of publishing an unsaved arrangement', async () => {
    mocks.reorder.mockRejectedValueOnce(new Error('Order could not be saved'))
    await render()
    await act(async () =>
      (container.querySelector('button[title="Move down"]') as HTMLButtonElement).click(),
    )
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Publish book'),
    )!
    expect(button.disabled).toBe(true)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)))
    expect(mocks.error).toHaveBeenCalledWith('Order could not be saved')
    expect(button.disabled).toBe(false)
    const text = container.textContent!
    expect(text.indexOf('Policy 1')).toBeLessThan(text.indexOf('Policy 2'))
    expect(mocks.publish).not.toHaveBeenCalled()
  })
})
