// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The record field binding is the offline record provider's job; here a
// stand-in keeps the shown value and records what the schedule queues.
const field = vi.hoisted(() => ({
  ids: [] as string[],
  change: vi.fn(),
  commit: vi.fn(),
  paused: false,
}))
vi.mock('@/lib/offline-drafts/offline-record', async () => {
  const { useState } = await import('react')
  return {
    useRecordField: <T,>(fieldId: string, serverValue: T) => {
      const [value, setValue] = useState(serverValue)
      field.ids.push(fieldId)
      return {
        value,
        change: (next: T) => {
          field.change(next)
          setValue(next)
        },
        commit: (next?: T) => {
          field.commit(next)
          if (next !== undefined) setValue(next)
        },
        saveState: 'idle',
        error: null,
        retry: () => {},
        paused: field.paused,
      }
    },
  }
})
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  useGeneratedValueTranslations: () => (value: string) => value,
  useGeneratedTranslations: () => (value: string) => value,
}))
import { ClassSchedule } from './_class-schedule'

let root: Root
let container: HTMLDivElement

async function render(props: { disabled?: boolean } = {}) {
  await act(async () =>
    root.render(<ClassSchedule startsAt="2026-10-05T07:30" endsAt="2026-10-05T12:00" {...props} />),
  )
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  field.ids = []
  field.paused = false
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const input = (name: string) => container.querySelector<HTMLInputElement>(`#class-${name}`)!

async function change(name: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input(name),
      value,
    )
    input(name).dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('atomic class schedule editing', () => {
  it('queues Start and End together as the one schedule edit', async () => {
    await render()
    expect(new Set(field.ids)).toEqual(new Set(['schedule']))

    await change('startsAt', '2026-10-30T07:30')
    // Start now sits past the old End: say so right away. The whole range is
    // still queued, so the saver refuses it and Email class waits for a fix.
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'End must be after Start',
    )
    expect(field.change).toHaveBeenLastCalledWith({
      startsAt: '2026-10-30T07:30',
      endsAt: '2026-10-05T12:00',
    })

    await change('endsAt', '2026-10-30T12:00')
    expect(field.change).toHaveBeenLastCalledWith({
      startsAt: '2026-10-30T07:30',
      endsAt: '2026-10-30T12:00',
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('writes typed times to the device when a time field loses focus', async () => {
    await render()
    await change('endsAt', '2026-10-05T13:00')
    await act(async () => {
      input('endsAt').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(field.commit).toHaveBeenCalledWith(undefined)
  })

  it('flags a cleared time as incomplete', async () => {
    await render()
    await change('startsAt', '')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enter both times')
  })

  it('is read-only while the class cannot be edited or editing is paused', async () => {
    await render({ disabled: true })
    expect(input('startsAt').disabled).toBe(true)
    expect(input('endsAt').disabled).toBe(true)

    await act(async () => root.unmount())
    root = createRoot(container)
    field.paused = true
    await render()
    expect(input('startsAt').disabled).toBe(true)
    expect(input('endsAt').disabled).toBe(true)
  })
})
