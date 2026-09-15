import { describe, expect, it } from 'vitest'
import { nextColumnPercents } from './_column-resize'

// Reported from the app: dragging a column edge "instantly doubles the size of
// the cell and locks it". Two faults fed that — the delta was measured in
// iframe pixels while the pointer moves in page pixels, so the first move
// saturated the clamp; and the drag re-resolved the selection each move, which
// GrapesJS had dropped, so nothing moved afterwards. This pins the arithmetic
// that decides where the boundary lands.

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10

describe('nextColumnPercents', () => {
  it('moves width from the right column to the left one', () => {
    expect(nextColumnPercents([20, 20, 60], 0, 5)).toEqual([25, 15, 60])
  })

  it('moves width the other way on a negative drag', () => {
    expect(nextColumnPercents([20, 20, 60], 0, -5)).toEqual([15, 25, 60])
  })

  it('always totals 100%, whatever the drag', () => {
    for (const delta of [-999, -37, -1, 0, 1, 37, 999]) {
      expect(sum(nextColumnPercents([25, 25, 25, 25], 1, delta))).toBe(100)
    }
  })

  it('never drags a column out of existence', () => {
    const [left, right] = nextColumnPercents([20, 20, 60], 0, 999)
    expect(right).toBeGreaterThanOrEqual(3)
    expect(left).toBeLessThanOrEqual(37)
  })

  it('leaves untouched columns exactly alone', () => {
    const out = nextColumnPercents([10, 30, 40, 20], 1, 12)
    expect(out[0]).toBe(10)
    expect(out[3]).toBe(20)
    expect(out[1]! + out[2]!).toBe(70)
  })

  it('does not jump when the drag has barely moved', () => {
    // The symptom: a tiny pointer move must produce a tiny change, not a jump
    // to the clamp. A 1% drag on a 20% column lands at 21, never at 37.
    expect(nextColumnPercents([20, 20, 60], 0, 1)).toEqual([21, 19, 60])
  })

  it('is a no-op at the last boundary or on a pair with no room', () => {
    expect(nextColumnPercents([50, 50], 1, 10)).toEqual([50, 50])
    expect(nextColumnPercents([3, 3, 94], 0, 10)).toEqual([3, 3, 94])
  })
})
