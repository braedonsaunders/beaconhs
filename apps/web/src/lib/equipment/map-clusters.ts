/** Group markers within a screen-space radius; zooming changes projected distances. */
export function clusterProjectedPoints(
  points: readonly { x: number; y: number }[],
  radius = 48,
): { indices: number[]; x: number; y: number }[] {
  const parents = points.map((_, index) => index)
  const cells = new Map<string, number[]>()
  function root(index: number): number {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!
      index = parents[index]!
    }
    return index
  }
  points.forEach((point, index) => {
    const cellX = Math.floor(point.x / radius)
    const cellY = Math.floor(point.y / radius)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const candidate of cells.get(`${cellX + dx},${cellY + dy}`) ?? []) {
          const other = points[candidate]!
          if ((point.x - other.x) ** 2 + (point.y - other.y) ** 2 <= radius ** 2) {
            parents[root(index)] = root(candidate)
          }
        }
      }
    }
    const key = `${cellX},${cellY}`
    const cell = cells.get(key) ?? []
    cell.push(index)
    cells.set(key, cell)
  })
  const groups = new Map<number, number[]>()
  points.forEach((_, index) => {
    const key = root(index)
    const group = groups.get(key) ?? []
    group.push(index)
    groups.set(key, group)
  })
  return [...groups.values()].map((indices) => ({
    indices,
    x: indices.reduce((sum, index) => sum + points[index]!.x, 0) / indices.length,
    y: indices.reduce((sum, index) => sum + points[index]!.y, 0) / indices.length,
  }))
}
