// Shared helpers for every report page under /incidents/reports/**.
//
// These compute the canonical safety-frequency metrics from the
// incident_hours_periods + incidents + incident_lost_time_events triple.

import { and, between, eq, gte, lte, sql } from 'drizzle-orm'
import {
  incidentClassifications,
  incidentHoursPeriods,
  incidentLostTimeEvents,
  incidents,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export const OSHA_MULTIPLIER = 200_000

// Parse a yyyy-mm-dd string back into a Date.  Null-safe.
export function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null
  const d = new Date(`${s}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

// Convenience: a tuple of [start, end] yyyy-mm-dd strings for the default
// rolling 12-month window ending today.
export function defaultRangeYmd(): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - 11)
  start.setDate(1)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

// Slice an [a, b] yyyy-mm-dd range into N month buckets.  Inclusive of
// both endpoints — used by every monthly chart.
export function monthBuckets(startYmd: string, endYmd: string): {
  key: string
  label: string
  start: string
  end: string
}[] {
  const out: { key: string; label: string; start: string; end: string }[] = []
  const a = parseDate(startYmd)
  const b = parseDate(endYmd)
  if (!a || !b) return out
  const cursor = new Date(a.getFullYear(), a.getMonth(), 1)
  while (cursor <= b) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const key = monthStart.toISOString().slice(0, 7)
    const label = monthStart.toLocaleString('en-US', { month: 'short', year: 'numeric' })
    out.push({
      key,
      label,
      start: monthStart.toISOString().slice(0, 10),
      end: monthEnd.toISOString().slice(0, 10),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return out
}

// Sum incident_hours_periods.totalHours that overlap the given [a, b]
// window.  A period overlaps the bucket if periodStart <= b AND
// periodEnd >= a.  For simplicity (matching the legacy report) we count
// the full period — sites are encouraged to enter per-month windows.
export async function hoursInRange(
  ctx: RequestContext,
  startYmd: string,
  endYmd: string,
): Promise<{ totalHours: number; employeeCount: number; periodCount: number }> {
  const [row] = await ctx.db((tx) =>
    tx
      .select({
        totalHours: sql<number>`coalesce(sum(${incidentHoursPeriods.totalHours}::numeric), 0)`.mapWith(Number),
        employeeCount: sql<number>`coalesce(sum(${incidentHoursPeriods.employeeCount}), 0)`.mapWith(Number),
        periodCount: sql<number>`count(*)`.mapWith(Number),
      })
      .from(incidentHoursPeriods)
      .where(
        and(
          lte(incidentHoursPeriods.periodStart, endYmd),
          gte(incidentHoursPeriods.periodEnd, startYmd),
        ),
      ),
  )
  return {
    totalHours: Number(row?.totalHours ?? 0),
    employeeCount: Number(row?.employeeCount ?? 0),
    periodCount: Number(row?.periodCount ?? 0),
  }
}

// Count incidents in [a, b] that resolve to a recordable classification.
// An incident is "recordable" when classificationRef.isRecordable = 1.
// If classificationId is null we fall back to severity heuristic:
// anything other than 'no_injury' counts as recordable.
export async function recordableCountInRange(
  ctx: RequestContext,
  startYmd: string,
  endYmd: string,
): Promise<number> {
  const [row] = await ctx.db((tx) =>
    tx
      .select({
        c: sql<number>`count(*)`.mapWith(Number),
      })
      .from(incidents)
      .leftJoin(
        incidentClassifications,
        eq(incidentClassifications.id, incidents.classificationId),
      )
      .where(
        and(
          between(
            sql`date(${incidents.occurredAt})` as any,
            startYmd as any,
            endYmd as any,
          ),
          sql`(
            (${incidentClassifications.isRecordable} = 1)
            or (${incidents.classificationId} is null and ${incidents.severity} <> 'no_injury')
          )`,
        ),
      ),
  )
  return Number(row?.c ?? 0)
}

// Sum days-away + days-restricted across all lost-time events that started
// in [a, b].  Used by the DART rate report.
export async function dartCountsInRange(
  ctx: RequestContext,
  startYmd: string,
  endYmd: string,
): Promise<{ dartCount: number; daysAway: number; daysRestricted: number }> {
  const [row] = await ctx.db((tx) =>
    tx
      .select({
        dartCount: sql<number>`count(distinct ${incidentLostTimeEvents.incidentId})`.mapWith(Number),
        daysAway: sql<number>`
          coalesce(sum(
            case when ${incidentLostTimeEvents.status} = 'off_work'
              then (coalesce(${incidentLostTimeEvents.validTo}, current_date) - ${incidentLostTimeEvents.validFrom})
              else 0
            end
          ), 0)
        `.mapWith(Number),
        daysRestricted: sql<number>`
          coalesce(sum(
            case when ${incidentLostTimeEvents.status} = 'restricted_duty'
              then (coalesce(${incidentLostTimeEvents.validTo}, current_date) - ${incidentLostTimeEvents.validFrom})
              else 0
            end
          ), 0)
        `.mapWith(Number),
      })
      .from(incidentLostTimeEvents)
      .where(
        and(
          gte(incidentLostTimeEvents.validFrom, startYmd as any),
          lte(incidentLostTimeEvents.validFrom, endYmd as any),
        ),
      ),
  )
  return {
    dartCount: Number(row?.dartCount ?? 0),
    daysAway: Number(row?.daysAway ?? 0),
    daysRestricted: Number(row?.daysRestricted ?? 0),
  }
}

// TRIR = recordable * 200000 / hours
export function trir(recordable: number, hours: number): number | null {
  if (!hours || hours <= 0) return null
  return (recordable * OSHA_MULTIPLIER) / hours
}

// Format a frequency rate with two decimals, or '—' if null.
export function fmtRate(r: number | null): string {
  if (r == null) return '—'
  return r.toFixed(2)
}
