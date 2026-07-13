import { describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { listDueSignals } from './_signals'

type ExecuteResult = { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>

function context(result: ExecuteResult): RequestContext {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    db: vi.fn(async (callback: (tx: { execute: () => Promise<ExecuteResult> }) => unknown) =>
      callback({ execute: async () => result }),
    ),
  } as unknown as RequestContext
}

const signalRow = {
  module: 'documents',
  family: 'Review due',
  subject: 'Emergency response plan',
  person_name: null,
  person_id: null,
  due_on: new Date('2026-07-12T00:00:00.000Z'),
  status: 'overdue',
  href: '/documents/00000000-0000-0000-0000-000000000002',
  total: '125',
  overdue_count: '70',
  expired_count: '10',
  due_soon_count: '40',
  open_count: '5',
}

describe('listDueSignals', () => {
  it('normalizes PostgreSQL QueryResult rows and bigint counts', async () => {
    const result = await listDueSignals(context({ rows: [signalRow] }), {
      page: 2,
      perPage: 25,
    })

    expect(result).toEqual({
      rows: [
        {
          module: 'documents',
          family: 'Review due',
          subject: 'Emergency response plan',
          personName: null,
          personId: null,
          dueOn: '2026-07-12',
          status: 'overdue',
          href: '/documents/00000000-0000-0000-0000-000000000002',
        },
      ],
      total: 125,
      counts: { overdue: 70, expired: 10, due_soon: 40, open: 5 },
    })
  })

  it('supports array-returning executors and omits the aggregate-only sentinel row', async () => {
    const result = await listDueSignals(
      context([
        {
          ...signalRow,
          module: null,
          family: null,
          subject: null,
          status: null,
          total: 0,
          overdue_count: 0,
          expired_count: 0,
          due_soon_count: 0,
          open_count: 0,
        },
      ]),
    )

    expect(result).toEqual({
      rows: [],
      total: 0,
      counts: { overdue: 0, expired: 0, due_soon: 0, open: 0 },
    })
  })
})
