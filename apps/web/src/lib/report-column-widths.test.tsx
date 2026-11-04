// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ReportStudio } from '@beaconhs/reports/react'
import { type CustomReportDefinition, DEFAULT_REPORT_LAYOUT } from '@beaconhs/reports'
import { BEACON_REPORT_CATALOG } from '@beaconhs/reports/entities'
const onSave = vi.fn(async () => ({ ok: true as const }))
let root: Root | undefined
let container: HTMLDivElement
let saved: CustomReportDefinition
function Harness() {
  const [value, setValue] = useState({
    definition: {
      schemaVersion: 1,
      id: 'new',
      slug: 'widths',
      name: 'Widths',
      state: 'draft',
      query: { entity: 'incidents', columns: ['reference', 'title'] },
      layout: DEFAULT_REPORT_LAYOUT,
    } as CustomReportDefinition,
  })
  return (
    <ReportStudio
      value={value}
      catalog={BEACON_REPORT_CATALOG}
      result={null}
      onChange={(next) => {
        saved = next.definition
        setValue(next)
      }}
      onPreview={async () => ({
        groups: [],
        summary: [],
        rowCount: 0,
        truncated: false,
        durationMs: 0,
      })}
      onSave={onSave}
      autoSaveMs={false}
      autoPreviewMs={false}
    />
  )
}
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  vi.unstubAllGlobals()
})
it('edits width beside the label override, clears Auto, and drops removed-column widths', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<Harness />))
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Width (px) for Reference"]',
  )!
  expect(input).not.toBeNull()
  expect(input.closest('li')?.querySelector('[placeholder="Label override"]')).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  async function enter(value: string) {
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await enter('240')
  expect(saved.query.columnWidths).toEqual({ reference: 240 })
  await enter('20')
  expect(saved.query.columnWidths).toEqual({ reference: 240 })
  expect(input.getAttribute('aria-invalid')).toBe('true')
  await enter('')
  expect(saved.query.columnWidths).toEqual({})
  await enter('300')
  const remove = input
    .closest('li')!
    .querySelector<HTMLButtonElement>('[aria-label="Remove column"]')!
  await act(async () => remove.click())
  expect(saved.query.columnWidths).toEqual({})
  expect(saved.query.columns).toEqual(['title'])
})
