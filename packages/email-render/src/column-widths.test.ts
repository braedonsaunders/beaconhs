import { describe, expect, it } from 'vitest'
import { autoColumnPercents, colgroupHtml } from './column-widths'

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10

describe('autoColumnPercents', () => {
  it('returns nothing for no columns and the full width for one', () => {
    expect(autoColumnPercents([])).toEqual([])
    expect(autoColumnPercents([{ header: 'Only', cells: ['{{name}}'] }])).toEqual([100])
  })

  it('keeps numbers and dates narrow and gives free text the slack', () => {
    const percents = autoColumnPercents([
      { header: 'Day', cells: ['{{day}} {{weekday}}'] },
      { header: 'Customer / site', cells: ['{{site_name}}'] },
      { header: 'Other destination', cells: ['{{other_destination}}'] },
      { header: 'Business km', cells: ['{{business_km}}'] },
      { header: 'Personal km', cells: ['{{personal_km}}'] },
      { header: 'Total km', cells: ['{{total_km}}'] },
    ])
    expect(sum(percents)).toBe(100)
    const [day, site, destination, business, personal, total] = percents as [
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    expect(destination).toBeGreaterThan(site)
    expect(site).toBeGreaterThan(day)
    for (const numeric of [business, personal, total]) {
      expect(numeric).toBeLessThan(site)
      expect(numeric).toBeLessThan(day)
    }
  })

  it('prefers declared value kinds over key-name guesses', () => {
    const guessed = autoColumnPercents([
      { header: 'A', cells: ['{{x}}'] },
      { header: 'B', cells: ['{{y}}'] },
    ])
    expect(guessed).toEqual([50, 50])
    const declared = autoColumnPercents(
      [
        { header: 'A', cells: ['{{x}}'] },
        { header: 'B', cells: ['{{y}}'] },
      ],
      { kinds: { x: 'bool', y: 'long_text' } },
    )
    expect(declared[0]).toBeLessThan(declared[1]!)
  })

  it('never lets a long heading word or a date wrap below its minimum when space allows', () => {
    const percents = autoColumnPercents([
      { header: 'Certification', cells: ['{{ok}}'] },
      { header: 'Expires', cells: ['{{expires_on}}'] },
      { header: 'Notes', cells: ['{{notes}}'] },
    ])
    // "Certification" (13) + padding beats the bool value it heads.
    expect(percents[0]).toBeGreaterThan(10)
    expect(percents[2]).toBeGreaterThan(percents[1]!)
  })

  it('ignores block helpers and markup and sizes blank write-in columns', () => {
    const percents = autoColumnPercents([
      { header: '#', cells: ['{{@number}}'] },
      { header: 'Name', cells: ['{{#if name}}<strong>{{name}}</strong>{{/if}}'] },
      { header: 'Signature', cells: ['&nbsp;'] },
    ])
    expect(sum(percents)).toBe(100)
    expect(percents[0]).toBeLessThan(percents[1]!)
    expect(percents[2]).toBeGreaterThan(percents[0]!)
  })

  it('keeps every column above the floor even with many wide columns', () => {
    const columns = Array.from({ length: 12 }, (_, i) => ({
      header: `Column ${i}`,
      cells: [i === 0 ? '{{is_ok}}' : '{{description}}'],
    }))
    const percents = autoColumnPercents(columns)
    expect(sum(percents)).toBe(100)
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(3)
  })

  it('renders a colgroup from the percentages', () => {
    expect(colgroupHtml([25, 75])).toBe(
      '<colgroup><col style="width:25%" /><col style="width:75%" /></colgroup>',
    )
  })
})
