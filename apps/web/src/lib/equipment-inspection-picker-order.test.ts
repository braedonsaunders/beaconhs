import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// CONTRACT TEST: every equipment-inspection-type picker offers its options in
// the SAME order — most frequent check first.
//
// The two picker branches used to sort differently: the per-unit scheduled list
// did `is_pre_use DESC, name ASC`, and the catalogue list did `name ASC` alone.
// Worse, sorting on the flag alone was not enough, because plenty of daily
// checks are not flagged pre-use ("Daily Engine Driver Welder Inspection",
// "Scaffolding Daily Inspection"). Alphabetically "Annual …" beats "Daily …",
// so on those units the annual check sat at the top of the list and people
// reaching for the daily one by habit submitted the wrong inspection.

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../app/api/picker-options/route.ts'),
  'utf8',
)

describe('equipment inspection type picker order', () => {
  it('defines the ordering exactly once', () => {
    expect(SOURCE.match(/const EQUIPMENT_INSPECTION_TYPE_ORDER =/g)).toHaveLength(1)
  })

  it('ranks pre-use first, then the shortest interval', () => {
    const start = SOURCE.indexOf('const EQUIPMENT_INSPECTION_TYPE_ORDER =')
    const order = SOURCE.slice(start, SOURCE.indexOf('\n]', start))

    expect(order).toContain('desc(equipmentInspectionTypes.isPreUse)')
    // Interval normalised to days so day < week < month < year regardless of
    // how the unit was configured.
    for (const unit of ['day', 'week', 'month', 'year']) {
      expect(order).toContain(`WHEN '${unit}' THEN`)
    }
    expect(order.indexOf('isPreUse')).toBeLessThan(order.indexOf('WHEN'))
    expect(order.indexOf('WHEN')).toBeLessThan(order.indexOf('equipmentInspectionTypes.name'))
  })

  it('is the only ordering any inspection-type picker applies', () => {
    const start = SOURCE.indexOf('const EQUIPMENT_INSPECTION_TYPE_ORDER =')
    const end = SOURCE.indexOf('\n]', start)
    const outsideTheConstant = SOURCE.slice(0, start) + SOURCE.slice(end)

    // Ranking these types on their own name or flag anywhere else means a
    // branch has drifted back to its own order. (Floating the currently
    // selected option to the top is not a ranking rule and stays allowed.)
    expect(outsideTheConstant).not.toContain('asc(equipmentInspectionTypes.name)')
    expect(outsideTheConstant).not.toContain('desc(equipmentInspectionTypes.isPreUse)')

    const usages = SOURCE.match(/\.\.\.EQUIPMENT_INSPECTION_TYPE_ORDER/g) ?? []
    expect(usages.length).toBeGreaterThanOrEqual(2)
  })
})
