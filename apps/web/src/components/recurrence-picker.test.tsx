// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/i18n/generated', () => ({
  useGeneratedTranslations: () => (key: string) => key,
  useGeneratedValueTranslations: () => (value: string) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
}))
import { RecurrencePicker } from './recurrence-picker'
import { describeRecurrence, recurrenceValueFromStored, type RecurrenceValue } from './recurrence'
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

async function typeNumber(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const trainingInput = (recurrence: RecurrenceValue) =>
  parseObligationInput({
    kind: 'training',
    title: 'Refresher',
    audience: [{ type: 'everyone', entityKey: 'all' }],
    recurrence,
    trainingItemKind: 'assessment_type',
    assessmentTypeId: '10000000-0000-4000-8000-000000000001',
  })

it('repeats a cadence every N units and round-trips it through storage', async () => {
  await render({ kind: 'frequency', frequency: 'year', evidenceWindow: 'rolling' })
  await typeNumber('rec-interval', '3')
  expect(current.interval).toBe(3)
  expect(document.getElementById('rec-interval')!.parentElement!.textContent).toContain('years')
  expect(trainingInput(current).ok).toBe(true)
  expect(
    recurrenceValueFromStored({
      kind: 'frequency',
      frequency: 'year',
      interval: 3,
      evidenceWindow: 'rolling',
    }),
  ).toMatchObject({ kind: 'frequency', frequency: 'year', interval: 3 })
  expect(
    describeRecurrence({
      kind: 'frequency',
      frequency: 'year',
      interval: 3,
      evidenceWindow: 'rolling',
    }),
  ).toBe('Rolling 3 years')
  expect(
    describeRecurrence({
      kind: 'frequency',
      frequency: 'year',
      interval: 2,
      evidenceWindow: 'calendar',
      deadline: { month: 12, day: 31, time: '23:59' },
    }),
  ).toBe('Every 2 years · Due by December 31 23:59')
})

it('makes a one-time requirement due a number of days after each person event', async () => {
  await render({ kind: 'frequency', frequency: 'year', evidenceWindow: 'rolling' })
  await select('rec-kind', 'after_event')
  expect(current.afterEvent).toEqual({ event: 'hire', days: 30, countPrior: false })
  expect(document.getElementById('rec-interval')).toBeNull()
  await typeNumber('rec-event-days', '14')
  await select('rec-event-prior', 'count')
  expect(current.afterEvent).toEqual({ event: 'hire', days: 14, countPrior: true })
  expect(trainingInput(current).ok).toBe(true)

  await select('rec-event', 'job_title')
  expect(trainingInput(current)).toEqual({
    ok: false,
    error: 'Pick the job title that starts the clock',
  })
  const withTitle = {
    ...current,
    afterEvent: { ...current.afterEvent!, titleId: '10000000-0000-4000-8000-000000000002' },
  }
  expect(trainingInput(withTitle).ok).toBe(true)
  expect(
    recurrenceValueFromStored({ kind: 'one_time', afterEvent: withTitle.afterEvent }),
  ).toMatchObject({ kind: 'after_event', afterEvent: withTitle.afterEvent })
  expect(describeRecurrence({ kind: 'one_time', afterEvent: withTitle.afterEvent })).toBe(
    'Within 14 days of job title assigned',
  )
  // Repeat-every and after-event rules belong to their own cadences only.
  expect(trainingInput({ kind: 'one_time', interval: 2 }).ok).toBe(false)
  expect(trainingInput({ kind: 'after_event' }).ok).toBe(false)
})
