import { describe, expect, it } from 'vitest'
import {
  isBulkActionId,
  MAX_BULK_ACTION_ITEMS,
  newBulkActionBatchId,
  parseBulkActionIds,
} from './bulk-actions'

describe('bulk action primitives', () => {
  it('uses the shared bounded mutation size', () => {
    expect(MAX_BULK_ACTION_ITEMS).toBe(500)
  })

  it('creates strong unique audit correlation ids', () => {
    const ids = Array.from({ length: 100 }, () => newBulkActionBatchId())
    expect(new Set(ids)).toHaveLength(ids.length)
    expect(
      ids.every((id) =>
        /^bat_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
      ),
    ).toBe(true)
  })

  it('normalizes and deduplicates a bounded UUID selection', () => {
    const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
    expect(
      parseBulkActionIds([upper, upper.toLowerCase()], {
        singular: 'record',
        plural: 'records',
      }),
    ).toEqual({ ok: true, ids: [upper.toLowerCase()] })
  })

  it.each([null, 'not-an-array', [null], ['not-a-uuid']])(
    'rejects malformed serialized selections %#',
    (value) => {
      expect(parseBulkActionIds(value, { singular: 'record', plural: 'records' })).toMatchObject({
        ok: false,
      })
    },
  )

  it('rejects empty and oversized operations instead of silently truncating them', () => {
    expect(parseBulkActionIds([], { singular: 'record', plural: 'records' })).toEqual({
      ok: false,
      error: 'No records selected.',
    })
    const ids = Array.from(
      { length: MAX_BULK_ACTION_ITEMS + 1 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    )
    expect(parseBulkActionIds(ids, { singular: 'record', plural: 'records' })).toMatchObject({
      ok: false,
      error: expect.stringContaining(String(MAX_BULK_ACTION_ITEMS)),
    })
  })

  it('validates associated UUID selectors', () => {
    expect(isBulkActionId('00000000-0000-4000-8000-000000000001')).toBe(true)
    expect(isBulkActionId('not-a-uuid')).toBe(false)
    expect(isBulkActionId(null)).toBe(false)
  })
})
