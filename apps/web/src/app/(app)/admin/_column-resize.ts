/** Smallest share a column may be reduced to, so it can never vanish. */
export const MIN_COLUMN_PCT = 3

/**
 * Column widths after dragging the boundary to the right of `index` by
 * `deltaPct` of the table's width.
 *
 * Width only ever moves between the two columns the boundary divides, so the
 * row still totals 100% and the table cannot creep off the page. Both keep at
 * least MIN_COLUMN_PCT so a column can never be dragged out of existence.
 */
export function nextColumnPercents(percents: number[], index: number, deltaPct: number): number[] {
  const left = percents[index]
  const right = percents[index + 1]
  if (left === undefined || right === undefined) return percents
  const pair = left + right
  if (pair <= MIN_COLUMN_PCT * 2) return percents
  const next = [...percents]
  const nextLeft = Math.min(Math.max(left + deltaPct, MIN_COLUMN_PCT), pair - MIN_COLUMN_PCT)
  next[index] = nextLeft
  next[index + 1] = pair - nextLeft
  return next
}
