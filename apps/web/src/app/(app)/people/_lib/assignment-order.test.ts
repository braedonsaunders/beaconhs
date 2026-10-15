import { describe, expect, it } from 'vitest'
import { orderIdsByName, parseIdList } from './assignment-order'

const A = '10000000-0000-4000-8000-00000000000a'
const B = '10000000-0000-4000-8000-00000000000b'
const C = '10000000-0000-4000-8000-00000000000c'
const D = '10000000-0000-4000-8000-00000000000d'

describe('person group / title chip order', () => {
  const names = new Map([
    [A, 'Welders'],
    [B, 'first aid'],
    [C, 'Crane operators'],
  ])

  it('orders by catalogue name regardless of case, then id', () => {
    expect(orderIdsByName([A, B, C], names)).toEqual([C, B, A])
    expect(orderIdsByName([C, A, B], names)).toEqual([C, B, A])
  })

  it('keeps the same order however the selection was built', () => {
    // The device appends new picks at the end; the server value is canonical.
    expect(orderIdsByName([A, C], names)).toEqual(orderIdsByName([C, A], names))
  })

  it('puts ids without a live catalogue name last, by id', () => {
    expect(orderIdsByName([D, A, B], names)).toEqual([B, A, D])
  })

  it('breaks name ties by id', () => {
    const tied = new Map([
      [B, 'Crew'],
      [A, 'crew'],
    ])
    expect(orderIdsByName([B, A], tied)).toEqual([A, B])
  })

  it('does not mutate its input', () => {
    const ids = [A, B, C]
    orderIdsByName(ids, names)
    expect(ids).toEqual([A, B, C])
  })
})

describe('submitted id lists', () => {
  it('trims and de-duplicates, keeping the given order', () => {
    expect(parseIdList([` ${B} `, A, B])).toEqual([B, A])
    expect(parseIdList([])).toEqual([])
  })

  it('refuses anything that is not a list of ids', () => {
    expect(() => parseIdList(A)).toThrow(/invalid/)
    expect(() => parseIdList(null)).toThrow(/invalid/)
    expect(() => parseIdList(['not-an-id'])).toThrow(/invalid/)
    expect(() => parseIdList([42])).toThrow(/invalid/)
  })
})
