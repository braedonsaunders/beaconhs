import { describe, expect, it } from 'vitest'
import {
  addMaintenanceDays,
  maintenanceMatchesPeriod,
  sortMaintenanceEntries,
  type MaintenanceEntry,
} from './maintenance-agenda'

const today = '2026-10-21'
function entry(
  key: string,
  dueOn: string | null,
  kind: MaintenanceEntry['kind'] = 'inspection',
): MaintenanceEntry {
  return {
    key,
    dueOn,
    kind,
    itemId: 'unit',
    itemName: 'Truck',
    assetTag: 'T1',
    title: key,
    detail: null,
  }
}

describe('maintenance work queue', () => {
  it('keeps undated repairs out of overdue counts and calendar date filters', () => {
    const repair = { ...entry('repair', null, 'work_order'), openedOn: '2025-01-01T00:00:00Z' }
    for (const period of ['overdue', 'today', 'week', 'month', 'undated']) {
      expect(maintenanceMatchesPeriod(repair, period, today, '2026-10')).toBe(false)
    }
    expect(maintenanceMatchesPeriod(repair, undefined, today, '2026-10')).toBe(true)
  })
  it('keeps future reminders available and separates missing schedule dates', () => {
    expect(
      maintenanceMatchesPeriod(
        entry('future', '2028-01-01', 'reminder'),
        undefined,
        today,
        '2026-10',
      ),
    ).toBe(true)
    expect(maintenanceMatchesPeriod(entry('setup', null), 'undated', today, '2026-10')).toBe(true)
    expect(maintenanceMatchesPeriod(entry('dated', today), 'undated', today, '2026-10')).toBe(false)
  })
  it('includes both boundaries of the next seven days, across month and year boundaries', () => {
    expect(addMaintenanceDays('2026-12-28', 7)).toBe('2027-01-04')
    for (const due of ['2026-12-28', '2027-01-04']) {
      expect(maintenanceMatchesPeriod(entry(due, due), 'week', '2026-12-28', '2026-12')).toBe(true)
    }
    expect(
      maintenanceMatchesPeriod(entry('late', '2027-01-05'), 'week', '2026-12-28', '2026-12'),
    ).toBe(false)
    expect(
      maintenanceMatchesPeriod(entry('old', '2026-12-27'), 'week', '2026-12-28', '2026-12'),
    ).toBe(false)
  })
  it('orders due work first, then repairs, missing dates, and future work without mutating the source', () => {
    const source = [
      entry('future', '2026-12-01'),
      entry('setup', null),
      entry('repair', null, 'work_order'),
      entry('today', today),
      entry('old', '2026-09-01'),
    ]
    expect(sortMaintenanceEntries(source, today).map((e) => e.key)).toEqual([
      'old',
      'today',
      'repair',
      'setup',
      'future',
    ])
    expect(source[0]?.key).toBe('future')
  })
  it('filters the selected calendar month without hiding overdue work from the all-dates queue', () => {
    const old = entry('old', '2026-09-30')
    expect(maintenanceMatchesPeriod(old, 'month', today, '2026-10')).toBe(false)
    expect(maintenanceMatchesPeriod(old, 'overdue', today, '2026-10')).toBe(true)
    expect(maintenanceMatchesPeriod(entry('last', '2026-10-31'), 'month', today, '2026-10')).toBe(
      true,
    )
  })
  it('uses evaluated usage conditions rather than a calendar date to decide whether service is ready', () => {
    const meter = { ...entry('meter', null, 'service'), serviceStatus: 'due' as const }
    const combined = {
      ...entry('combined', '2026-09-01', 'service'),
      serviceStatus: 'upcoming' as const,
    }
    expect(maintenanceMatchesPeriod(meter, 'ready', today, '2026-10')).toBe(true)
    expect(maintenanceMatchesPeriod(meter, 'undated', today, '2026-10')).toBe(false)
    expect(maintenanceMatchesPeriod(combined, 'overdue', today, '2026-10')).toBe(false)
    expect(maintenanceMatchesPeriod(combined, 'ready', today, '2026-10')).toBe(false)
    expect(sortMaintenanceEntries([combined, meter], today)[0]?.key).toBe('meter')
    expect(
      maintenanceMatchesPeriod(
        { ...meter, serviceStatus: 'needs_setup' },
        'undated',
        today,
        '2026-10',
      ),
    ).toBe(true)
  })
})
