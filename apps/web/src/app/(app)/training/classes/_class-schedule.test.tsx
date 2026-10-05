// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  useGeneratedValueTranslations: () => (value: string) => value,
  useGeneratedTranslations: () => (value: string) => value,
}))
import { ClassSchedule } from './_class-schedule'
import { flushRecordSaves } from '@/lib/pending-record-saves'
let root: Root
let container: HTMLDivElement
const update = vi.fn()
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  update.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <ClassSchedule
        id="class"
        startsAt="2026-10-05T07:30"
        endsAt="2026-10-05T12:00"
        updateAction={update}
      />,
    ),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function change(field: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(`#class-${field}`)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
describe('atomic class schedule editing', () => {
  it('lets the manager move Start past the old End, then saves the complete new range', async () => {
    await change('startsAt', '2026-10-30T07:30')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'End must be after Start',
    )
    await act(async () => {
      await expect(flushRecordSaves()).rejects.toThrow()
    })
    expect(update).not.toHaveBeenCalled()
    await change('endsAt', '2026-10-30T12:00')
    await act(async () => {
      await flushRecordSaves()
    })
    expect(update).toHaveBeenCalledTimes(1)
    const form = update.mock.calls[0]![0] as FormData
    expect(form.get('field')).toBe('schedule')
    expect(JSON.parse(String(form.get('value')))).toEqual({
      startsAt: '2026-10-30T07:30',
      endsAt: '2026-10-30T12:00',
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('clears a failed pending range when the manager restores the original valid range', async () => {
    await change('startsAt', '2026-10-30T07:30')
    await act(async () => {
      await expect(flushRecordSaves()).rejects.toThrow()
    })
    await change('startsAt', '2026-10-05T07:30')
    await act(async () => {
      await flushRecordSaves()
    })
    expect(update).toHaveBeenCalledTimes(1)
  })
})
