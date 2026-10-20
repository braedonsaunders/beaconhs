// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/i18n/generated', () => ({
  useGeneratedTranslations: () => (key: string) => key,
  GeneratedText: ({ id }: { id: string }) => id,
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
}))
import { RecurrencePicker } from './recurrence-picker'
import { recurrenceValueFromStored, type RecurrenceValue } from './recurrence'
import { parseObligationInput } from '../app/(app)/compliance/obligations/_input'

let root: Root | undefined, container: HTMLDivElement | undefined
let current: RecurrenceValue
const actGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  container?.remove()
  root = undefined
  container = undefined
  vi.unstubAllGlobals()
  delete actGlobals.IS_REACT_ACT_ENVIRONMENT
})
async function render(initial: RecurrenceValue) {
  actGlobals.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  function Wrapper() {
    const [value, setValue] = useState(initial)
    current = value
    return (
      <RecurrencePicker
        value={value}
        onChange={setValue}
        fields={{ oneTime: true, recurring: true, rolling: true, remind: true }}
      />
    )
  }
  await act(async () => root!.render(<Wrapper />))
}
function control(id: string): HTMLSelectElement {
  return document.getElementById(id)!.closest('span')!.querySelector('select')!
}
async function select(id: string, value: string) {
  const element = control(id)
  expect(element).not.toBeNull()
  await act(async () => {
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
it('offers concrete calendar deadlines for all frequencies and clears them when switching to a one-time date', async () => {
  await render({ kind: 'frequency', frequency: 'year', evidenceWindow: 'rolling' })
  expect(document.getElementById('rec-cron')).toBeNull()
  expect(document.getElementById('rec-deadline-month')).toBeNull()
  await select('rec-window', 'calendar')
  expect(current.deadline).toEqual({ month: 12, day: 31, time: '23:59' })
  expect(control('rec-deadline-month').selectedOptions[0]?.textContent).toBe('December')
  await select('rec-deadline-month', '3')
  expect(current.deadline?.month).toBe(3)
  await select('rec-freq', 'quarter')
  expect(current.deadline).toEqual({ month: 3, day: 31, time: '23:59' })
  expect(control('rec-deadline-month').options.length).toBe(3)
  await select('rec-freq', 'month')
  expect(current.deadline).toEqual({ day: 31, time: '23:59' })
  expect(document.getElementById('rec-deadline-month')).toBeNull()
  await select('rec-freq', 'week')
  await select('rec-deadline-weekday', '5')
  expect(current.deadline).toEqual({ weekday: 5, time: '23:59' })
  await select('rec-freq', 'day')
  expect(current.deadline).toEqual({ time: '23:59' })
  expect(document.getElementById('rec-deadline-day')).toBeNull()
  await select('rec-kind', 'one_time')
  expect(current.deadline).toBeUndefined()
  expect(current.evidenceWindow).toBeUndefined()
  expect(document.getElementById('rec-due')).not.toBeNull()
  expect(
    parseObligationInput({
      kind: 'training',
      title: 'One-time safety quiz',
      audience: [{ type: 'everyone', entityKey: 'all' }],
      recurrence: current,
      trainingItemKind: 'assessment_type',
      assessmentTypeId: '10000000-0000-4000-8000-000000000001',
    }).ok,
  ).toBe(true)
})
it('preserves a stored fixed deadline when opening the editor', () => {
  const deadline = { month: 6, day: 30, time: '17:00' }
  expect(
    recurrenceValueFromStored({
      kind: 'frequency',
      frequency: 'year',
      evidenceWindow: 'calendar',
      deadline,
    }),
  ).toMatchObject({ kind: 'frequency', frequency: 'year', evidenceWindow: 'calendar', deadline })
})

it('offers a whole-period journal deadline without a technical cron override', async () => {
  actGlobals.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  function Journal() {
    const [value, setValue] = useState<RecurrenceValue>({
      kind: 'frequency',
      frequency: 'week',
      quantity: 5,
      evidenceWindow: 'calendar',
    })
    current = value
    return (
      <RecurrencePicker
        value={value}
        onChange={setValue}
        fields={{ recurring: true, quantity: true, threshold: true, calendar: true }}
      />
    )
  }
  await act(async () => root!.render(<Journal />))
  expect(document.getElementById('rec-cron')).toBeNull()
  expect(control('rec-deadline-weekday').value).toBe('7')
  expect((document.getElementById('rec-deadline-time') as HTMLInputElement).value).toBe('23:59')
  await select('rec-deadline-weekday', '5')
  expect(current.deadline).toEqual({ weekday: 5, time: '23:59' })
  expect(
    parseObligationInput({
      kind: 'journal',
      title: 'Foremen — Weekly journals',
      audience: [{ type: 'everyone', entityKey: '' }],
      recurrence: current,
    }).ok,
  ).toBe(true)
})
