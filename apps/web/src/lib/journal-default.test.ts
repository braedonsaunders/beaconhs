import { expect, it } from 'vitest'
import { employeeJournalDefault, resolveJournalDefault } from './journal-default'
it('uses the explicit employee setting and defaults to worker', () => {
  expect(resolveJournalDefault({ journalDefinition: 'worker' })).toBe('worker')
  expect(resolveJournalDefault({ journalDefinition: 'supervisor' })).toBe('supervisor')
  expect(resolveJournalDefault({})).toBe('worker')
  expect(employeeJournalDefault({ journalDefinition: 'manager' })).toBeNull()
  expect(resolveJournalDefault({ journalDefinition: 'manager' })).toBe('worker')
})
