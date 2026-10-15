import { beforeEach, describe, expect, it, vi } from 'vitest'

const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: vi.fn() }))

import type { RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'
import { optionalDecimal, requiredText, columnOps } from './codecs'
import {
  defineRecordSaver,
  RecordEditRejection,
  recordLocked,
  recordOp,
  type RecordChange,
} from './edits'

type Row = { id: string; title: string; cost: string | null; locked: boolean }

const RECORD_ID = '5b0f3c3e-2f7a-4d6e-9a51-0c6f4c1b2d3e'

function harness(row: Row, options: { authorized?: boolean } = {}) {
  const statements: string[] = []
  const writes: Array<Partial<Row>> = []
  const audits: RecordChange[][] = []
  const tx = {
    execute: async (query: { queryChunks?: Array<{ value?: string[] }> }) => {
      statements.push(
        (query.queryChunks ?? [])
          .flatMap((chunk) => chunk.value ?? [])
          .join('')
          .trim(),
      )
    },
  } as unknown as Database
  const ctx = {
    tenantId: 'tenant-1',
    timezone: 'America/Toronto',
    db: <T>(fn: (db: Database) => Promise<T>) => fn(tx),
  } as unknown as RequestContext
  const saver = defineRecordSaver<Row>('test', {
    authorize: () => options.authorized ?? true,
    async load() {
      if (row.locked) throw recordLocked('This record is locked.')
      return row
    },
    resolve: (_tx, _ctx, loaded, op) => {
      if (op === 'explode') {
        return recordOp<string>({
          current: 'a',
          parse: (wire) => String(wire),
          format: (value) => value,
          write: async () => {
            throw new RecordEditRejection('That value clashes with another record.')
          },
        })
      }
      if (op === 'crash') {
        return recordOp<string>({
          current: 'a',
          parse: (wire) => String(wire),
          format: (value) => value,
          write: async () => {
            throw new Error('connection reset')
          },
        })
      }
      return columnOps(
        loaded,
        {
          title: requiredText({ label: 'Title', maxLength: 20 }),
          cost: optionalDecimal({ label: 'Cost', maxScale: 2 }),
        },
        async (patch) => {
          writes.push(patch)
        },
      )(op)
    },
    async afterWrites(_tx, _ctx, _loaded, changes) {
      audits.push(changes)
    },
    revalidate: (id) => [`/things/${id}`],
  })
  return { saver, ctx, statements, writes, audits }
}

beforeEach(() => {
  revalidatePath.mockClear()
})

describe('record saver compare-and-set', () => {
  it('writes an edit whose base is still current, audits it, and revalidates', async () => {
    const row: Row = { id: RECORD_ID, title: 'Ladder', cost: null, locked: false }
    const { saver, ctx, writes, audits, statements } = harness(row)
    const result = await saver(ctx, RECORD_ID, [
      { fieldId: 'title', value: '  Ladder slip ', base: 'Ladder' },
    ])
    expect(result).toEqual({
      ok: true,
      kind: 'fields',
      applied: [{ fieldId: 'title', stored: 'Ladder slip' }],
      conflicts: [],
      rejected: [],
    })
    expect(writes).toEqual([{ title: 'Ladder slip' }])
    expect(row.title).toBe('Ladder slip')
    expect(audits).toEqual([[{ op: 'title', before: 'Ladder', after: 'Ladder slip' }]])
    expect(statements).toEqual(['savepoint record_sync_edit', 'release savepoint record_sync_edit'])
    expect(revalidatePath).toHaveBeenCalledWith(`/things/${RECORD_ID}`)
  })

  it('acknowledges a retry whose value is already stored without writing again', async () => {
    const row: Row = { id: RECORD_ID, title: 'Ladder slip', cost: null, locked: false }
    const { saver, ctx, writes, audits } = harness(row)
    const result = await saver(ctx, RECORD_ID, [
      { fieldId: 'title', value: 'Ladder slip', base: 'Ladder' },
    ])
    expect(result).toMatchObject({
      ok: true,
      applied: [{ fieldId: 'title', stored: 'Ladder slip' }],
    })
    expect(writes).toEqual([])
    expect(audits).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('never overwrites a newer value: a stale base is a conflict with the current value', async () => {
    const row: Row = { id: RECORD_ID, title: 'Changed elsewhere', cost: null, locked: false }
    const { saver, ctx, writes } = harness(row)
    const result = await saver(ctx, RECORD_ID, [
      { fieldId: 'title', value: 'Mine', base: 'Ladder' },
    ])
    expect(result).toMatchObject({
      ok: true,
      applied: [],
      conflicts: [{ fieldId: 'title', current: 'Changed elsewhere' }],
    })
    expect(writes).toEqual([])
  })

  it('compares bases in canonical form (numeric columns come back zero-padded)', async () => {
    const row: Row = { id: RECORD_ID, title: 'Ladder', cost: '12.50', locked: false }
    const { saver, ctx, writes } = harness(row)
    const result = await saver(ctx, RECORD_ID, [{ fieldId: 'cost', value: '13', base: '12.50' }])
    expect(result).toMatchObject({ ok: true, applied: [{ fieldId: 'cost', stored: '13' }] })
    expect(writes).toEqual([{ cost: '13' }])
  })

  it('refuses an invalid value per field and keeps applying the rest of the batch', async () => {
    const row: Row = { id: RECORD_ID, title: 'Ladder', cost: null, locked: false }
    const { saver, ctx, writes } = harness(row)
    const result = await saver(ctx, RECORD_ID, [
      { fieldId: 'title', value: '   ', base: 'Ladder' },
      { fieldId: 'cost', value: '4.25', base: '' },
      { fieldId: 'nope', value: 'x', base: '' },
    ])
    expect(result).toEqual({
      ok: true,
      kind: 'fields',
      applied: [{ fieldId: 'cost', stored: '4.25' }],
      conflicts: [],
      rejected: [
        { fieldId: 'title', error: 'Title is required.' },
        { fieldId: 'nope', error: 'This field can no longer be edited.' },
      ],
    })
    expect(writes).toEqual([{ cost: '4.25' }])
  })

  it('reports an invalid value on a field that changed elsewhere as a conflict', async () => {
    const row: Row = { id: RECORD_ID, title: 'Changed elsewhere', cost: null, locked: false }
    const { saver, ctx } = harness(row)
    const result = await saver(ctx, RECORD_ID, [{ fieldId: 'title', value: '', base: 'Ladder' }])
    expect(result).toMatchObject({
      conflicts: [{ fieldId: 'title', current: 'Changed elsewhere' }],
      rejected: [],
    })
  })

  it('rolls back only the field whose write was refused', async () => {
    const row: Row = { id: RECORD_ID, title: 'Ladder', cost: null, locked: false }
    const { saver, ctx, statements } = harness(row)
    const result = await saver(ctx, RECORD_ID, [
      { fieldId: 'explode', value: 'b', base: 'a' },
      { fieldId: 'title', value: 'Ladder slip', base: 'Ladder' },
    ])
    expect(result).toMatchObject({
      applied: [{ fieldId: 'title', stored: 'Ladder slip' }],
      rejected: [{ fieldId: 'explode', error: 'That value clashes with another record.' }],
    })
    expect(statements.slice(0, 2)).toEqual([
      'savepoint record_sync_edit',
      'rollback to savepoint record_sync_edit',
    ])
  })

  it('answers with a reason when no edit can apply', async () => {
    const locked = harness({ id: RECORD_ID, title: 'x', cost: null, locked: true })
    expect(
      await locked.saver(locked.ctx, RECORD_ID, [{ fieldId: 'title', value: 'y', base: 'x' }]),
    ).toEqual({ ok: false, reason: 'locked', error: 'This record is locked.' })

    const forbidden = harness(
      { id: RECORD_ID, title: 'x', cost: null, locked: false },
      { authorized: false },
    )
    expect(
      await forbidden.saver(forbidden.ctx, RECORD_ID, [
        { fieldId: 'title', value: 'y', base: 'x' },
      ]),
    ).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('retries later when something unexpected fails', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const crash = harness({ id: RECORD_ID, title: 'x', cost: null, locked: false })
    expect(
      await crash.saver(crash.ctx, RECORD_ID, [{ fieldId: 'crash', value: 'b', base: 'a' }]),
    ).toEqual({ ok: false, reason: 'unavailable', error: 'Unable to save right now.' })
    quiet.mockRestore()
  })
})
