// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INCIDENT_METRICS } from '@beaconhs/db/incident-metrics'

const commit = vi.hoisted(() => vi.fn())
vi.mock('@/i18n/generated', () => ({
  GeneratedText: () => null,
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
vi.mock('@/lib/offline-drafts/offline-record', () => ({
  useRecordField: (_field: string, initial: string) => {
    const [value, setValue] = useState(initial)
    return {
      value,
      saveState: 'idle',
      paused: false,
      error: null,
      commit: (next: string) => {
        commit(next)
        setValue(next)
      },
    }
  },
}))
import { LiveMetricRating } from './live-field'
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  commit.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(index: number, value: number | null = null, disabled = false) {
  const metric = INCIDENT_METRICS[index]!
  await act(async () =>
    root.render(
      <LiveMetricRating
        key={index}
        field={metric.field}
        options={metric.options}
        help={metric.help}
        higherIsBetter={metric.higherIsBetter}
        label={metric.question}
        initialValue={value}
        disabled={disabled}
      />,
    ),
  )
}
describe('incident metric ratings', () => {
  it('starts unanswered, shows every explanation, saves and clears a selection', async () => {
    await render(0)
    expect(commit).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull()
    for (const option of INCIDENT_METRICS[0].options)
      expect(container.textContent).toContain(option)
    const button = container.querySelectorAll('button')[3]!
    await act(async () => button.click())
    expect(commit).toHaveBeenLastCalledWith('4')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    await act(async () => button.click())
    expect(commit).toHaveBeenLastCalledWith('')
  })
  it('reverses the colours for positive scales without changing numeric answers', async () => {
    await render(0, 5)
    expect(container.querySelector('[aria-pressed="true"]')?.className).toContain('bg-red-100')
    await render(3, 5)
    expect(container.querySelector('[aria-pressed="true"]')?.className).toContain('bg-emerald-100')
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('5')
    expect(commit).not.toHaveBeenCalled()
  })
  it('cannot change a locked incident', async () => {
    await render(4, 2, true)
    for (const button of container.querySelectorAll('button')) {
      expect(button.disabled).toBe(true)
      await act(async () => button.click())
    }
    expect(commit).not.toHaveBeenCalled()
  })
})
