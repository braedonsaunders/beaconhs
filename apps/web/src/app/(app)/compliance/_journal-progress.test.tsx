import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  GeneratedText: () => null,
}))
import { JournalProgress, journalProgressPercent } from './_journal-progress'
it('shows partial individual progress without letting one person cover someone else', () => {
  expect(
    journalProgressPercent([
      { count: 2, expected: 5 },
      { count: 0, expected: 5 },
    ]),
  ).toBe(20)
  expect(
    journalProgressPercent([
      { count: 10, expected: 5 },
      { count: 0, expected: 5 },
    ]),
  ).toBe(50)
  expect(journalProgressPercent([])).toBe(0)
  const html = renderToStaticMarkup(<JournalProgress count={4} expected={5} met />)
  expect(html).toContain('4')
  expect(html).toContain('5')
  expect(html).toContain('submitted')
  expect(html).toContain('Minimum met')
  expect(html).toContain('width:80%')
})
