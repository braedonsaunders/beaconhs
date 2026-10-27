// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// The record provider (device store + sync engine) has its own tests; here
// each field is a plain binding that adopts new server values like the real
// one does once nothing is pending.
const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  commit: vi.fn(),
  errors: {} as Record<string, string>,
  paused: false,
}))
vi.mock('@/lib/offline-drafts/offline-record', () => ({
  RecordSyncStatus: () => <span data-testid="sync-status" />,
  RecordSyncBanner: () => <div data-testid="sync-banner" />,
  useRecordField: (fieldId: string, server: string) => {
    const [value, setValue] = useState(server)
    useEffect(() => setValue(server), [server])
    return {
      value,
      change: (next: string) => {
        setValue(next)
        mocks.change(fieldId, next)
      },
      commit: (next?: string) => {
        if (next !== undefined) setValue(next)
        mocks.commit(fieldId, next)
      },
      saveState: mocks.errors[fieldId] ? 'error' : 'idle',
      error: mocks.errors[fieldId] ?? null,
      retry: vi.fn(),
      paused: mocks.paused,
    }
  },
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedText: ({ id }: { id: string }) => id,
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { DocumentOverview } from './_overview'

const initial = {
  title: 'Procedure',
  key: 'proc',
  categoryId: '',
  typeId: '',
  description: '',
  reviewFrequencyMonths: '',
  nextReviewOn: '',
  showDocumentHeader: true,
  headerIssuedOn: '',
  headerRevisedOn: '',
  headerApprovedBy: '',
  headerVersionLabel: '',
}
let root: Root
let container: HTMLDivElement
async function render(meta = initial, hasMaster = true) {
  await act(async () =>
    root.render(
      <DocumentOverview initialMeta={meta} categories={[]} types={[]} hasMaster={hasMaster} />,
    ),
  )
}
beforeEach(async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  vi.clearAllMocks()
  mocks.errors = {}
  mocks.paused = false
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await render()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function input(id: string) {
  return container.querySelector<HTMLInputElement>(`#${id}`)!
}
async function type(id: string, value: string) {
  const element = input(id)
  await act(async () => {
    element.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('document overview fields', () => {
  it('queues each header field by its op key without saving on open', async () => {
    expect(mocks.change).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="sync-status"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="sync-banner"]')).not.toBeNull()
    await type('o-issued', '2024-01-01')
    await type('o-revised', '2026-09-01')
    await type('o-approved', 'Alex Morgan')
    await type('o-version', 'Rev B')
    expect(mocks.change.mock.calls).toEqual([
      ['headerIssuedOn', '2024-01-01'],
      ['headerRevisedOn', '2026-09-01'],
      ['headerApprovedBy', 'Alex Morgan'],
      ['headerVersionLabel', 'Rev B'],
    ])
    await act(async () => input('o-version').blur())
    expect(mocks.commit).toHaveBeenLastCalledWith('headerVersionLabel', undefined)
  })

  it('keeps what was typed while focused, then shows the saved canonical value', async () => {
    await type('o-key', 'Safety ')
    await render({ ...initial, key: 'safety' })
    expect(input('o-key').value).toBe('Safety ')
    await act(async () => input('o-key').blur())
    expect(input('o-key').value).toBe('safety')
  })

  it('switches the PDF header with a string wire value and only with a Word master', async () => {
    await act(async () => input('o-document-header').click())
    expect(mocks.commit).toHaveBeenCalledWith('showDocumentHeader', 'false')
    await render(initial, false)
    expect(input('o-document-header').disabled).toBe(true)
  })

  it('shows why the server refused a value next to the field', async () => {
    mocks.errors = { key: 'A live document already uses that key.' }
    await render({ ...initial })
    await type('o-key', 'other')
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(
      'A live document already uses that key.',
    )
  })

  it('disables every field while editing is paused', async () => {
    mocks.paused = true
    await render({ ...initial })
    for (const id of [
      'o-title',
      'o-key',
      'o-desc',
      'o-review',
      'o-approved',
      'o-document-header',
    ]) {
      expect(input(id).disabled).toBe(true)
    }
  })
})
