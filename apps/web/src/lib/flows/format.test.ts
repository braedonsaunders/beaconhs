import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { fmtDate, fmtDateTime } from './format'
import { renderFormFieldText } from './form-subject-values'

const toronto = 'America/Toronto'

describe('flow and PDF dates', () => {
  it('prints instants on the tenant clock, not the server’s (UTC) clock', () => {
    // 19:00 UTC on Nov 18 is 2 pm in Toronto.
    expect(fmtDateTime(new Date('2026-11-18T19:00:00Z'), toronto)).toBe('2026-11-18 14:00')
    expect(fmtDateTime('2026-11-19T12:29:02.507Z', toronto)).toBe('2026-11-19 07:29')
    // Late evening in Toronto is already the next day in UTC.
    expect(fmtDate(new Date('2026-11-19T03:30:00Z'), toronto)).toBe('2026-11-18')
    expect(fmtDateTime(null, toronto)).toBe('')
  })

  it('keeps calendar-day columns as they are', () => {
    expect(fmtDate('2026-11-19', toronto)).toBe('2026-11-19')
  })

  it('prints form datetime answers on the tenant clock', () => {
    const field = { type: 'datetime', config: {} } as Parameters<typeof renderFormFieldText>[0]
    expect(renderFormFieldText(field, '2026-11-18T14:00', { timeZone: toronto })).toBe(
      '2026-11-18 14:00',
    )
    expect(renderFormFieldText(field, '2026-11-18T19:00:00.000Z', { timeZone: toronto })).toBe(
      '2026-11-18 14:00',
    )
  })
})
