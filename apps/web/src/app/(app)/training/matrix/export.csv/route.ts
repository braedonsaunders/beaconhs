// Matrix CSV export — same filter contract as the page itself (department,
// trade, crew). Emits one row per person with one column per course; the
// cell text uses 'valid', 'expiring', 'expired', or 'never'.

import { NextRequest } from 'next/server'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { people, trainingCourses, trainingRecords } from '@beaconhs/db/schema'
import { requireExportContext } from '@/lib/auth'
import { csvFilename, csvResponse } from '@/lib/csv'

const EXPIRING_WINDOW_DAYS = 90

export async function GET(req: NextRequest) {
  const ctx = await requireExportContext()
  const sp = req.nextUrl.searchParams
  const departmentFilter = sp.get('department') || undefined
  const tradeFilter = sp.get('trade') || undefined
  const crewFilter = sp.get('crew') || undefined

  const { peopleRows, coursesRows, recs } = await ctx.db(async (tx) => {
    const peopleQuery = await tx
      .select()
      .from(people)
      .where(
        and(
          eq(people.status, 'active'),
          isNull(people.deletedAt),
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
    return { peopleRows: peopleQuery, coursesRows: coursesQuery, recs: recRows }
  })

  const today = new Date()
  const todayMs = today.getTime()
  const latest = new Map<string, { completedOn: string; expiresOn: string | null }>()
  for (const r of recs) {
    const key = `${r.personId}:${r.courseId}`
    const cur = latest.get(key)
    if (!cur || r.completedOn > cur.completedOn) {
      latest.set(key, { completedOn: r.completedOn, expiresOn: r.expiresOn })
    }
  }

  const headers = [
    'Employee #',
    'Last name',
    'First name',
    ...coursesRows.map((c) => `${c.code}: ${c.name}`),
  ]
  const rows: (string | null)[][] = peopleRows.map((p) => {
    const row: (string | null)[] = [p.employeeNo ?? null, p.lastName, p.firstName]
    for (const c of coursesRows) {
      const r = latest.get(`${p.id}:${c.id}`)
      if (!r) {
        row.push('never')
      } else if (!r.expiresOn) {
        row.push('valid')
      } else {
        const expMs = new Date(r.expiresOn).getTime()
        const days = Math.round((expMs - todayMs) / 86_400_000)
        if (days < 0) row.push(`expired ${-days}d ago`)
        else if (days <= EXPIRING_WINDOW_DAYS) row.push(`expiring ${days}d`)
        else row.push('valid')
      }
    }
    return row
  })

  return csvResponse({
    filename: csvFilename('training-matrix'),
    headers,
    rows,
  })
}
