import Link from 'next/link'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Check } from 'lucide-react'
import { Button, PageHeader } from '@beaconhs/ui'
import {
  crews,
  departments,
  people,
  trades,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { pickString } from '@/lib/list-params'
import { TrainingSubNav } from '../_components/training-sub-nav'

export const metadata = { title: 'Training matrix' }
export const dynamic = 'force-dynamic'

type CellState =
  | { kind: 'valid'; daysLeft: number | null; expiresOn: string | null }
  | { kind: 'expiring'; daysLeft: number; expiresOn: string }
  | { kind: 'expired'; daysAgo: number; expiresOn: string }
  | { kind: 'never' }

const EXPIRING_WINDOW_DAYS = 90

/**
 * Compute the latest "valid" record per (personId, courseId) → state.
 * "Latest" = highest completedOn. If multiple records exist, the newest one
 * wins regardless of expiry chain.
 */
function computeCells(
  recs: { personId: string; courseId: string; completedOn: string; expiresOn: string | null }[],
  todayIso: string,
): Map<string, CellState> {
  const today = new Date(todayIso)
  const latest = new Map<string, { completedOn: string; expiresOn: string | null }>()
  for (const r of recs) {
    const key = `${r.personId}:${r.courseId}`
    const cur = latest.get(key)
    if (!cur || r.completedOn > cur.completedOn) {
      latest.set(key, { completedOn: r.completedOn, expiresOn: r.expiresOn })
    }
  }
  const out = new Map<string, CellState>()
  for (const [key, v] of latest.entries()) {
    if (!v.expiresOn) {
      out.set(key, { kind: 'valid', daysLeft: null, expiresOn: null })
      continue
    }
    const exp = new Date(v.expiresOn)
    const days = Math.round((exp.getTime() - today.getTime()) / 86_400_000)
    if (days < 0) {
      out.set(key, { kind: 'expired', daysAgo: -days, expiresOn: v.expiresOn })
    } else if (days <= EXPIRING_WINDOW_DAYS) {
      out.set(key, { kind: 'expiring', daysLeft: days, expiresOn: v.expiresOn })
    } else {
      out.set(key, { kind: 'valid', daysLeft: days, expiresOn: v.expiresOn })
    }
  }
  return out
}

export default async function TrainingMatrixPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const departmentFilter = pickString(sp.department)
  const tradeFilter = pickString(sp.trade)
  const crewFilter = pickString(sp.crew)
  const ctx = await requireModuleManage('training')

  const { peopleRows, coursesRows, recs, deptsRows, tradesRows, crewsRows } = await ctx.db(
    async (tx) => {
      const peopleFilters = [eq(people.status, 'active'), isNull(people.deletedAt)] as const
      const peopleQuery = await tx
        .select()
        .from(people)
        .where(
          and(
            ...peopleFilters,
            departmentFilter ? eq(people.departmentId, departmentFilter) : undefined,
            tradeFilter ? eq(people.tradeId, tradeFilter) : undefined,
            crewFilter ? eq(people.crewId, crewFilter) : undefined,
          ),
        )
        .orderBy(asc(people.lastName), asc(people.firstName))

      const coursesQuery = await tx
        .select()
        .from(trainingCourses)
        .where(isNull(trainingCourses.deletedAt))
        .orderBy(asc(trainingCourses.name))

      const ids = peopleQuery.map((p) => p.id)
      const recRows = ids.length
        ? await tx
            .select({
              personId: trainingRecords.personId,
              courseId: trainingRecords.courseId,
              completedOn: trainingRecords.completedOn,
              expiresOn: trainingRecords.expiresOn,
            })
            .from(trainingRecords)
            .where(and(inArray(trainingRecords.personId, ids), isNull(trainingRecords.deletedAt)))
        : []

      const ds = await tx.select().from(departments).orderBy(asc(departments.name))
      const ts = await tx.select().from(trades).orderBy(asc(trades.name))
      const cs = await tx.select().from(crews).orderBy(asc(crews.name))
      return {
        peopleRows: peopleQuery,
        coursesRows: coursesQuery,
        recs: recRows,
        deptsRows: ds,
        tradesRows: ts,
        crewsRows: cs,
      }
    },
  )

  const todayIso = new Date().toISOString().slice(0, 10)
  const cells = computeCells(recs, todayIso)

  // Column-level summary tallies.
  const courseStats = new Map<
    string,
    { valid: number; expiring: number; expired: number; never: number }
  >()
  for (const c of coursesRows)
    courseStats.set(c.id, { valid: 0, expiring: 0, expired: 0, never: 0 })
  for (const p of peopleRows) {
    for (const c of coursesRows) {
      const cell = cells.get(`${p.id}:${c.id}`)
      const stat = courseStats.get(c.id)!
      if (!cell) stat.never += 1
      else if (cell.kind === 'valid') stat.valid += 1
      else if (cell.kind === 'expiring') stat.expiring += 1
      else if (cell.kind === 'expired') stat.expired += 1
    }
  }

  // Build CSV link with current filters.
  const csvHref = (() => {
    const qs = new URLSearchParams()
    if (departmentFilter) qs.set('department', departmentFilter)
    if (tradeFilter) qs.set('trade', tradeFilter)
    if (crewFilter) qs.set('crew', crewFilter)
    const q = qs.toString()
    return `/training/matrix/export.csv${q ? `?${q}` : ''}`
  })()

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Training matrix"
            description="Person × course coverage — each cell shows the latest record's status."
            actions={
              <div className="flex items-center gap-2">
                <Link href={csvHref as any}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <a
                  href="javascript:window.print()"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                >
                  Print
                </a>
              </div>
            }
          />
          <TrainingSubNav active="matrix" />
          <div className="flex flex-wrap items-center gap-2">
            {deptsRows.length > 0 ? (
              <FilterChips
                basePath="/training/matrix"
                currentParams={sp}
                paramKey="department"
                label="Department"
                options={deptsRows.map((d) => ({ value: d.id, label: d.name }))}
              />
            ) : null}
            {tradesRows.length > 0 ? (
              <FilterChips
                basePath="/training/matrix"
                currentParams={sp}
                paramKey="trade"
                label="Trade"
                options={tradesRows.map((t) => ({ value: t.id, label: t.name }))}
              />
            ) : null}
            {crewsRows.length > 0 ? (
              <FilterChips
                basePath="/training/matrix"
                currentParams={sp}
                paramKey="crew"
                label="Crew"
                options={crewsRows.map((c) => ({ value: c.id, label: c.name }))}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-green-200" /> Valid
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-amber-200" /> Expiring (≤
              {EXPIRING_WINDOW_DAYS}d)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-red-200" /> Expired
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border border-slate-200 bg-white" />
              Never taken
            </span>
          </div>
        </>
      }
    >
      {peopleRows.length === 0 || coursesRows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {peopleRows.length === 0
            ? 'No active people match the current filters.'
            : 'No courses defined.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-700">
                  Person
                </th>
                {coursesRows.map((c) => (
                  <th
                    key={c.id}
                    title={c.name}
                    className="rotate-text-sticky max-w-[120px] truncate border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-700"
                  >
                    <Link href={`/training/courses/${c.id}`} className="hover:underline">
                      {c.code}
                    </Link>
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-1 text-left text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                  {peopleRows.length} people
                </th>
                {coursesRows.map((c) => {
                  const s = courseStats.get(c.id)!
                  return (
                    <th
                      key={c.id}
                      className="border-b border-l border-slate-200 bg-slate-50 px-1 py-1 text-[10px] font-normal text-slate-500"
                    >
                      <span className="text-green-700">{s.valid}</span>/
                      <span className="text-amber-700">{s.expiring}</span>/
                      <span className="text-red-700">{s.expired}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {peopleRows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 text-left font-normal text-slate-800 hover:bg-slate-50"
                  >
                    <Link href={`/training/transcripts/${p.id}`} className="hover:underline">
                      {p.lastName}, {p.firstName}
                    </Link>
                  </th>
                  {coursesRows.map((c) => {
                    const cell = cells.get(`${p.id}:${c.id}`)
                    return (
                      <td
                        key={c.id}
                        className={cellClass(cell)}
                        title={cellTitle(p.firstName + ' ' + p.lastName, c.name, cell)}
                      >
                        {cellGlyph(cell)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  )
}

function cellClass(cell: CellState | undefined): string {
  if (!cell) return 'border-b border-l border-slate-100 px-2 py-1.5 text-center text-slate-300'
  if (cell.kind === 'valid')
    return 'border-b border-l border-slate-100 bg-green-50 px-2 py-1.5 text-center text-green-700'
  if (cell.kind === 'expiring')
    return 'border-b border-l border-slate-100 bg-amber-50 px-2 py-1.5 text-center text-amber-700'
  if (cell.kind === 'expired')
    return 'border-b border-l border-slate-100 bg-red-50 px-2 py-1.5 text-center text-red-700'
  return 'border-b border-l border-slate-100 px-2 py-1.5 text-center text-slate-300'
}

function cellGlyph(cell: CellState | undefined): React.ReactNode {
  if (!cell) return '·'
  if (cell.kind === 'valid')
    return (
      <span className="inline-flex items-center justify-center">
        <Check size={12} />
      </span>
    )
  if (cell.kind === 'expiring') return `${cell.daysLeft}d`
  if (cell.kind === 'expired') return '✗'
  return '·'
}

function cellTitle(person: string, course: string, cell: CellState | undefined): string {
  if (!cell) return `${person} · ${course}: never taken`
  if (cell.kind === 'valid')
    return `${person} · ${course}: valid${cell.expiresOn ? ` (expires ${cell.expiresOn})` : ' (no expiry)'}`
  if (cell.kind === 'expiring')
    return `${person} · ${course}: expires in ${cell.daysLeft}d (${cell.expiresOn})`
  if (cell.kind === 'expired')
    return `${person} · ${course}: expired ${cell.daysAgo}d ago (${cell.expiresOn})`
  return `${person} · ${course}: never taken`
}
