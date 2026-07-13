import { describe, expect, it } from 'vitest'
import type { PersonStatusRow } from './_hub'
import { filterAndSortPersonRows, personRowMatchesStatus } from './_person-list'

const rows: PersonStatusRow[] = [
  {
    kind: 'training',
    obligationId: 'training',
    title: 'Fall protection',
    status: 'overdue',
    dueOn: '2026-07-01',
    completedOn: null,
    targetRef: null,
  },
  {
    kind: 'document',
    obligationId: 'document',
    title: 'Read site policy',
    status: 'completed',
    dueOn: '2026-07-20',
    completedOn: '2026-07-10',
    targetRef: null,
  },
  {
    kind: 'form',
    obligationId: 'form',
    title: 'Monthly check',
    status: 'in_progress',
    dueOn: '2026-07-15',
    completedOn: null,
    targetRef: null,
  },
]

describe('person compliance list', () => {
  it('maps operational status filters without hiding in-progress work', () => {
    expect(rows.filter((row) => personRowMatchesStatus(row, 'urgent'))).toHaveLength(1)
    expect(rows.filter((row) => personRowMatchesStatus(row, 'outstanding'))).toHaveLength(2)
    expect(rows.filter((row) => personRowMatchesStatus(row, 'completed'))).toHaveLength(1)
  })

  it('searches kind labels and sorts by due date', () => {
    expect(
      filterAndSortPersonRows(rows, {
        q: 'training',
        sort: 'due',
        dir: 'asc',
      }).map((row) => row.obligationId),
    ).toEqual(['training'])

    expect(
      filterAndSortPersonRows(rows, { sort: 'due', dir: 'asc' }).map((row) => row.obligationId),
    ).toEqual(['training', 'form', 'document'])
  })
})
