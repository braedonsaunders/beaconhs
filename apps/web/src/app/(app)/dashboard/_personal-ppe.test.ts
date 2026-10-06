import { describe, expect, it } from 'vitest'
import { drizzle, type NodePgClient } from 'drizzle-orm/node-postgres'
import type { Database } from '@beaconhs/db'
import { loadPersonalPpe } from './_personal-ppe'

const personId = '12f93dc0-2e7e-4895-a7bc-8571156609df'
function database() {
  const queries: { text: string; values: unknown[] }[] = []
  const client = {
    query: async (config: { text: string }, values: unknown[]) => {
      queries.push({ text: config.text, values })
      return {
        rows: [
          [
            'harness',
            '106164646-104',
            null,
            'issued',
            '2026-01-21',
            '2027-01-21',
            '2026-01-21',
            '2027-01-21',
            'Harness',
            true,
            4,
            4,
          ],
          ['shirt', null, null, 'issued', null, null, null, null, 'Hi Viz Shirts', false, 0, 0],
          [
            'annual-due',
            null,
            null,
            'issued',
            '2026-10-01',
            '2026-10-10',
            null,
            null,
            'Harness',
            true,
            4,
            4,
          ],
          ['unsafe', null, null, 'out_of_service', null, null, null, null, 'Harness', true, 4, 4],
          ['due', null, null, 'issued', null, null, null, null, 'Lanyard', true, 7, 7],
        ],
      }
    },
  } as unknown as NodePgClient
  return { tx: drizzle(client) as unknown as Database, queries }
}

describe('personal PPE dashboard data', () => {
  it('keeps current and non-inspectable assigned PPE while prioritizing required inspections', async () => {
    const { tx, queries } = database()
    const items = await loadPersonalPpe(tx, personId, '2026-10-01', true)
    expect(items.map((item) => item.id)).toEqual([
      'annual-due',
      'unsafe',
      'due',
      'shirt',
      'harness',
    ])
    expect(items.find((item) => item.id === 'harness')).toMatchObject({
      inspectionState: 'current',
      inspectionDueOn: '2027-01-21',
      canRecordPreUse: true,
    })
    expect(items.find((item) => item.id === 'shirt')).toMatchObject({
      inspectionState: 'not_required',
      inspectionKind: null,
      canRecordPreUse: false,
    })
    expect(items.find((item) => item.id === 'annual-due')).toMatchObject({
      inspectionKind: 'annual',
      inspectionState: 'never_inspected',
      canRecordPreUse: true,
    })
    expect(items.find((item) => item.id === 'unsafe')?.canRecordPreUse).toBe(false)
    expect(queries[0]!.text).toContain('"ppe_items"."current_holder_person_id" =')
    expect(queries[0]!.text).toContain('"ppe_items"."deleted_at" is null')
    expect(queries[0]!.values).toEqual([personId, 'issued', 'out_of_service'])
  })
  it('does not offer inspections without inspection permission', async () => {
    const { tx } = database()
    const items = await loadPersonalPpe(tx, personId, '2026-10-01', false)
    expect(items.every((item) => !item.canRecordPreUse)).toBe(true)
  })
  it('does not query the register for an unlinked account', async () => {
    const { tx, queries } = database()
    expect(await loadPersonalPpe(tx, null, '2026-10-01', true)).toEqual([])
    expect(queries).toEqual([])
  })
})
