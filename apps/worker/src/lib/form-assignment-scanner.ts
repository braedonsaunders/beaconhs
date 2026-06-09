// Scheduled form-assignment scanner.
//
// Walks every active form_assignments row where mode='scheduled' and a cron
// expression is present. For each, computes "is the cron due now" relative to
// the latest dispatch (or the assignment's createdAt if no dispatches yet).
// Each due assignment:
//   1. inserts a form_assignment_dispatches row
//   2. resolves an audience from targetPersonIds / targetOrgUnitIds /
//      targetRoleKeys and enqueues an in-app notification per assignee
//
// To be wired up from apps/worker/src/workers/scheduled.ts case
// 'form_assignment_scan' (touching that file is out of scope for this agent —
// see scope notes in summary).
//
// Idempotency: the scanner re-checks max(occurredAt) per assignment before
// inserting, so a tick that fires twice in the same minute will only insert
// once. Multiple worker replicas could still race; we'd add an advisory lock
// per assignment if/when that matters.

import { and, asc, desc, eq, isNotNull, max, type SQL } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { formAssignmentDispatches, formAssignments, formTemplates } from '@beaconhs/db/schema'
import { resolveObligationAudience, type AudienceItem } from '@beaconhs/compliance'
import { enqueueNotification } from '@beaconhs/jobs'

export type CronFields = {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

/**
 * Parse a small subset of cron syntax: `m h dom mon dow` with `*`, single
 * numbers, `a,b,c` lists, and step syntax like `* / n`. No ranges, no named
 * months/days. Throws on parse error; callers catch and skip the assignment.
 */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron must have 5 fields, got ${parts.length}: ${expr}`)
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string]
  return {
    minute: parseField(m, 0, 59),
    hour: parseField(h, 0, 23),
    dayOfMonth: parseField(dom, 1, 31),
    month: parseField(mon, 1, 12),
    dayOfWeek: parseField(dow, 0, 6),
  }
}

function parseField(s: string, min: number, max: number): number[] {
  const out: number[] = []
  for (const part of s.split(',')) {
    const stepMatch = /^(\*|\d+)\/(\d+)$/.exec(part)
    if (stepMatch) {
      const base = stepMatch[1] === '*' ? min : Number(stepMatch[1])
      const step = Number(stepMatch[2])
      if (!Number.isFinite(base) || !Number.isFinite(step) || step <= 0) {
        throw new Error(`bad cron step: ${part}`)
      }
      for (let i = base; i <= max; i += step) out.push(i)
      continue
    }
    if (part === '*') {
      for (let i = min; i <= max; i++) out.push(i)
      continue
    }
    const n = Number(part)
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`bad cron value: ${part}`)
    }
    out.push(n)
  }
  return Array.from(new Set(out)).sort((a, b) => a - b)
}

/**
 * Find the next time at or after `from` (exclusive of `from` itself) when the
 * cron fields match. Returns null if no match within ~1 year (defensive — a
 * well-formed cron always has a match within a year).
 */
export function nextCronAfter(c: CronFields, from: Date): Date | null {
  // Walk minute-by-minute. Cheap enough for a 1-year ceiling because we skip
  // forward on mismatches at coarser granularity.
  const max = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000)
  // Start at the next minute boundary after `from`.
  const candidate = new Date(from.getTime() + 60_000)
  candidate.setUTCSeconds(0, 0)
  while (candidate.getTime() <= max.getTime()) {
    if (!c.month.includes(candidate.getUTCMonth() + 1)) {
      // Jump to the 1st of the next month.
      candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1)
      candidate.setUTCHours(0, 0, 0, 0)
      continue
    }
    if (
      !c.dayOfMonth.includes(candidate.getUTCDate()) ||
      !c.dayOfWeek.includes(candidate.getUTCDay())
    ) {
      candidate.setUTCDate(candidate.getUTCDate() + 1)
      candidate.setUTCHours(0, 0, 0, 0)
      continue
    }
    if (!c.hour.includes(candidate.getUTCHours())) {
      candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0)
      continue
    }
    if (!c.minute.includes(candidate.getUTCMinutes())) {
      candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0)
      continue
    }
    return new Date(candidate)
  }
  return null
}

export type FormAssignmentScanResult = {
  candidates: number
  dispatched: number
  skipped: number
  errors: number
}

export async function scanFormAssignments(
  now: Date = new Date(),
): Promise<FormAssignmentScanResult> {
  const result: FormAssignmentScanResult = {
    candidates: 0,
    dispatched: 0,
    skipped: 0,
    errors: 0,
  }

  // Pull all active scheduled assignments + their last-fire timestamps.
  const rows = await withSuperAdmin(db, async (tx) => {
    return tx
      .select({
        assignment: formAssignments,
        templateName: formTemplates.name,
        lastFiredAt: max(formAssignmentDispatches.occurredAt),
      })
      .from(formAssignments)
      .innerJoin(formTemplates, eq(formTemplates.id, formAssignments.templateId))
      .leftJoin(
        formAssignmentDispatches,
        eq(formAssignmentDispatches.assignmentId, formAssignments.id),
      )
      .where(
        and(
          eq(formAssignments.mode, 'scheduled'),
          eq(formAssignments.enabled, true),
          isNotNull(formAssignments.cron),
        ),
      )
      .groupBy(formAssignments.id, formTemplates.name)
      .orderBy(asc(formAssignments.id))
  })

  for (const row of rows) {
    result.candidates += 1
    const { assignment, templateName, lastFiredAt } = row
    if (!assignment.cron) {
      result.skipped += 1
      continue
    }
    let fields: CronFields
    try {
      fields = parseCron(assignment.cron)
    } catch (err) {
      result.errors += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[form_assignment_scan] bad cron on ${assignment.id}: ${msg}`)
      continue
    }

    const after = lastFiredAt ?? assignment.createdAt
    const due = nextCronAfter(fields, after)
    if (!due || due.getTime() > now.getTime()) {
      result.skipped += 1
      continue
    }

    try {
      const audience = await resolveAssigneeUserIds(assignment)
      await withSuperAdmin(db, (tx) =>
        tx.insert(formAssignmentDispatches).values({
          tenantId: assignment.tenantId,
          assignmentId: assignment.id,
          occurredAt: due,
          status: audience.length > 0 ? 'scheduled' : 'skipped',
          audienceUserIds: audience,
          error: audience.length === 0 ? 'no audience' : null,
        }),
      )

      if (audience.length > 0) {
        await enqueueNotification({
          tenantId: assignment.tenantId,
          userIds: audience,
          category: 'forms',
          type: 'form_assignment.due',
          title: `Form due: ${templateName}`,
          body: assignment.dueOffsetMinutes
            ? `Please complete within ${assignment.dueOffsetMinutes} minutes.`
            : undefined,
          linkPath: `/forms/templates/${assignment.templateId}/fill?assignment=${assignment.id}`,
          data: { assignmentId: assignment.id, templateId: assignment.templateId },
        })
        result.dispatched += 1
      } else {
        result.skipped += 1
      }
    } catch (err) {
      result.errors += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[form_assignment_scan] dispatch ${assignment.id} failed: ${msg}`)
    }
  }

  if (result.dispatched > 0 || result.errors > 0) {
    console.log(
      `[form_assignment_scan] candidates=${result.candidates} dispatched=${result.dispatched} skipped=${result.skipped} errors=${result.errors}`,
    )
  }
  return result
}

// --- Audience resolver ----------------------------------------------------

async function resolveAssigneeUserIds(
  assignment: typeof formAssignments.$inferSelect,
): Promise<string[]> {
  // Delegates to the ONE canonical resolver (@beaconhs/compliance) — no
  // duplicated audience logic. Maps the form_assignment JSONB target arrays to
  // the unified AudienceItem shape, then collapses to notifiable user ids.
  const items: AudienceItem[] = [
    ...(assignment.targetPersonIds ?? []).map((id) => ({ kind: 'person' as const, entityKey: id })),
    ...(assignment.targetRoleKeys ?? []).map((k) => ({ kind: 'role' as const, entityKey: k })),
    ...(assignment.targetOrgUnitIds ?? []).map((id) => ({ kind: 'org_unit' as const, entityKey: id })),
  ]
  if (items.length === 0) return []
  const members = await withSuperAdmin(db, (tx) =>
    resolveObligationAudience(tx, assignment.tenantId, items),
  )
  return members.map((m) => m.userId).filter((u): u is string => Boolean(u))
}

// Re-export for potential tests / direct invocation.
export { formAssignmentDispatches }
