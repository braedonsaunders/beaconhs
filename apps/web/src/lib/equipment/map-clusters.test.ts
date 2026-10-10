import { describe, expect, it } from 'vitest'
import { clusterProjectedPoints } from './map-clusters'

describe('equipment map clusters', () => {
  it('groups nearby pins across grid boundaries and preserves every equipment identity', () => {
    const groups = clusterProjectedPoints([
      { x: 47, y: 0 },
      { x: 49, y: 0 },
      { x: 92, y: 0 },
      { x: 300, y: 0 },
    ])
    expect(groups.map((group) => group.indices)).toEqual([[0, 1, 2], [3]])
    expect(groups[0]!.x).toBeCloseTo(188 / 3)
  })

  it('separates nearby positions when zoom increases while keeping co-located units selectable', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 0 },
    ]
    expect(clusterProjectedPoints(points).map((group) => group.indices)).toEqual([[0, 1, 2]])
    expect(
      clusterProjectedPoints(points.map((point) => ({ x: point.x * 4, y: point.y * 4 }))).map(
        (group) => group.indices,
      ),
    ).toEqual([[0], [1, 2]])
  })

  it('handles empty maps and negative projected coordinates', () => {
    expect(clusterProjectedPoints([])).toEqual([])
    expect(
      clusterProjectedPoints([
        { x: -1, y: -1 },
        { x: 1, y: 1 },
      ])[0]!.indices,
    ).toEqual([0, 1])
  })
})
