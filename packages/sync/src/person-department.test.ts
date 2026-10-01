import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { resolvePersonDepartment } from './person-department'
import { upsertRecord } from './upsert'

const tenantId = '362623eb-f615-4610-b2f9-3422dde18cf4'
const departmentId = '3be5dbb0-bce4-48fc-ab3a-4ab65bab9962'
function database(results: { id: string }[][], inserted: { id: string }[] = []) {
  const queries: SQL[] = []
  const writes: Record<string, unknown>[] = []
  let reads = 0
  const tx = {
    select: () => {
      const query = {
        from: () => query,
        where: (predicate: SQL) => {
          queries.push(predicate)
          return query
        },
        limit: () => query,
        for: () => query,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(results[reads++] ?? []).then(resolve),
      }
      return query
    },
    insert: () => {
      const query = {
        values: (values: Record<string, unknown>) => {
          writes.push(values)
          return query
        },
        onConflictDoNothing: () => query,
        returning: async () => inserted,
      }
      return query
    },
  } as unknown as Database
  return { tx, writes, queries }
}
const context = { tenantId, log: () => {} }

test('reuses the tenant department with Unicode, case and spacing normalization', async () => {
  const db = database([[{ id: departmentId }]])
  assert.equal(await resolvePersonDepartment(db.tx, context, '  Ｓｈｏｐ  '), departmentId)
  assert.equal(db.writes.length, 0)
  const query = new PgDialect().sqlToQuery(db.queries[0]!)
  assert.ok(query.params.includes(tenantId))
  assert.ok(query.params.includes('Shop'))
  assert.match(query.sql, /"departments"\."tenant_id"/)
  assert.match(query.sql, /normalize\(/)
})

test('creates a missing department and resolves a concurrent insert winner', async () => {
  const created = database([[]], [{ id: departmentId }])
  assert.equal(await resolvePersonDepartment(created.tx, context, ' New   shop '), departmentId)
  assert.deepEqual(created.writes, [{ tenantId, name: 'New shop' }])
  const race = database([[], [{ id: departmentId }]])
  assert.equal(await resolvePersonDepartment(race.tx, context, 'Shop'), departmentId)
  assert.equal(race.queries.length, 2)
})

test('previews a missing department without writing and blank names clear the assignment', async () => {
  const db = database([[]])
  const logs: string[] = []
  const id = await resolvePersonDepartment(
    db.tx,
    { tenantId, dryRun: true, log: (_level, message) => logs.push(message) },
    'Shop',
  )
  assert.match(id!, /^[a-f0-9-]{36}$/)
  assert.deepEqual(logs, ['Would create department "Shop".'])
  assert.equal(db.writes.length, 0)
  assert.equal(await resolvePersonDepartment(db.tx, context, '  '), null)
  assert.equal(db.queries.length, 1)
})

test('does not retain a department id from a rolled-back record savepoint', async () => {
  const db = database([[], []], [{ id: departmentId }])
  await resolvePersonDepartment(db.tx, context, 'Shop')
  await resolvePersonDepartment(db.tx, context, 'Shop')
  assert.equal(db.queries.length, 2)
  assert.equal(db.writes.length, 2)
})

test('rejects an orphaned source department before changing any person fields', async () => {
  await assert.rejects(
    upsertRecord(
      {} as Database,
      {
        tenantId,
        connectionId: '1edfea1c-a35a-4e8b-9974-14da4d2ed7ec',
        sourceSystem: 'database',
        log: () => {},
        lookups: {
          tradeByName: new Map(),
          equipTypeByName: new Map(),
          orgUnitIdByCode: new Map(),
          personIdByEmployeeNo: new Map(),
          personIdByExternalEmployeeId: new Map(),
        },
      },
      {
        entity: 'people',
        externalId: 'person:1',
        data: {
          firstName: 'Test',
          lastName: 'Employee',
          departmentExternalId: '3',
          departmentName: null,
        },
      },
    ),
    /Source department 3 has no resolved name/,
  )
})
