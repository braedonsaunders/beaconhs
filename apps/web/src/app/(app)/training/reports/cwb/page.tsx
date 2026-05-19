import Link from 'next/link'
import { asc, eq, ilike, or, sql } from 'drizzle-orm'
import { Flame } from 'lucide-react'
import {
  Badge,
  Button,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  people,
  trades,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../../_components/training-sub-nav'

export const metadata = { title: 'CWB welder report' }
export const dynamic = 'force-dynamic'

/**
 * The CWB-registered shop's audit hands them a list of welders with each one's
 * CWB ticket — number, position, process, expiry date, and the procedure they
 * qualified against.
 *
 * Heuristic for selection:
 *   1. Anyone whose trade.name contains "weld" (case-insensitive), or
 *   2. Anyone holding a skill type under an authority whose name contains
 *      "CWB" or "Canadian Welding Bureau".
 *
 * We don't have a dedicated `welder_qualifications` table so we use the
 * notes/code on trainingSkillTypes + skillAssignments.notes to carry the
 * procedure number etc. The report is read-only — pivot the data the user
 * already entered.
 */
export default async function CwbWelderReportPage() {
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const { welders } = await ctx.db(async (tx) => {
    // 1. Find welder trade(s)
    const welderTrades = await tx
      .select()
      .from(trades)
      .where(ilike(trades.name, '%weld%'))

    // 2. Find CWB-related authorities
    const cwbAuths = await tx
      .select()
      .from(trainingSkillAuthorities)
      .where(
        or(
          ilike(trainingSkillAuthorities.name, '%CWB%'),
          ilike(trainingSkillAuthorities.name, '%Canadian Welding Bureau%'),
          ilike(trainingSkillAuthorities.code, '%CWB%'),
        ),
      )

    // 3. Find people with welder trade or CWB skill
    const welderTradeIds = welderTrades.map((t) => t.id)
    const cwbAuthIds = cwbAuths.map((a) => a.id)

    const peopleByTrade = welderTradeIds.length
      ? await tx
          .select()
          .from(people)
          .where(
            sql`${people.tradeId} = ANY(${sql.raw(
              `ARRAY[${welderTradeIds.map((id) => `'${id}'`).join(',')}]::uuid[]`,
            )}) AND ${people.status} = 'active' AND ${people.deletedAt} IS NULL`,
          )
      : []

    const peopleByCwbSkill = cwbAuthIds.length
      ? await tx
          .selectDistinct({ p: people })
          .from(people)
          .innerJoin(
            trainingSkillAssignments,
            eq(trainingSkillAssignments.personId, people.id),
          )
          .innerJoin(
            trainingSkillTypes,
            eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
          )
          .where(
            sql`${trainingSkillTypes.authorityId} = ANY(${sql.raw(
              `ARRAY[${cwbAuthIds.map((id) => `'${id}'`).join(',')}]::uuid[]`,
            )}) AND ${people.status} = 'active' AND ${people.deletedAt} IS NULL`,
          )
      : []

    const byId = new Map<string, (typeof people.$inferSelect)>()
    for (const p of peopleByTrade) byId.set(p.id, p)
    for (const r of peopleByCwbSkill) byId.set(r.p.id, r.p)

    if (byId.size === 0) {
      return { welders: [] as const }
    }

    // 4. Pull all skills for those people, then we'll filter to CWB-ish ones
    const skillRows = await tx
      .select({
        assignment: trainingSkillAssignments,
        type: trainingSkillTypes,
        authority: trainingSkillAuthorities,
      })
      .from(trainingSkillAssignments)
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .where(
        sql`${trainingSkillAssignments.personId} = ANY(${sql.raw(
          `ARRAY[${Array.from(byId.keys()).map((id) => `'${id}'`).join(',')}]::uuid[]`,
        )})`,
      )
      .orderBy(asc(trainingSkillAssignments.expiresOn))

    const skillsByPerson = new Map<string, typeof skillRows>()
    for (const row of skillRows) {
      const ps = skillsByPerson.get(row.assignment.personId) ?? []
      ps.push(row)
      skillsByPerson.set(row.assignment.personId, ps)
    }

    const tradesById = new Map<string, string>()
    for (const t of welderTrades) tradesById.set(t.id, t.name)
    // Pull the tradeId names for everyone in scope, even non-welder trades.
    const allTradeIds = Array.from(byId.values())
      .map((p) => p.tradeId)
      .filter((x): x is string => !!x)
    if (allTradeIds.length > 0) {
      const tns = await tx
        .select()
        .from(trades)
        .where(
          sql`${trades.id} = ANY(${sql.raw(
            `ARRAY[${allTradeIds.map((id) => `'${id}'`).join(',')}]::uuid[]`,
          )})`,
        )
      for (const t of tns) tradesById.set(t.id, t.name)
    }

    const welders = Array.from(byId.values())
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
      .map((p) => {
        const skills = skillsByPerson.get(p.id) ?? []
        // Highlight CWB-issued ones first
        skills.sort((a, b) => {
          const aCwb = /cwb|canadian welding/i.test(a.authority.name)
          const bCwb = /cwb|canadian welding/i.test(b.authority.name)
          if (aCwb && !bCwb) return -1
          if (!aCwb && bCwb) return 1
          return 0
        })
        return {
          person: p,
          tradeName: p.tradeId ? tradesById.get(p.tradeId) ?? null : null,
          skills,
        }
      })
    return { welders }
  })

  // Tally
  const stats = welders.reduce(
    (acc, w) => {
      acc.total += 1
      for (const s of w.skills) {
        acc.totalCerts += 1
        if (s.assignment.expiresOn) {
          if (s.assignment.expiresOn < today) acc.expired += 1
          else acc.active += 1
        } else {
          acc.active += 1
        }
      }
      return acc
    },
    { total: 0, totalCerts: 0, active: 0, expired: 0 },
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="CWB welder report"
            description="Welders + their CWB certifications and weld procedure qualifications. Auto-included if their trade name contains 'weld' or if they hold a skill issued by a CWB-named authority."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/training/reports/cwb/export.csv">
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <a
                  href="javascript:window.print()"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                >
                  Print / PDF
                </a>
              </div>
            }
          />
          <TrainingSubNav active="reports" />
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Flame size={12} className="text-orange-500" /> {stats.total} welders ·{' '}
              {stats.totalCerts} certifications · {stats.active} active · {stats.expired}{' '}
              expired
            </span>
          </div>
        </>
      }
    >
      {welders.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No welders matched. Create a trade containing "welder" or an authority named "CWB" to
          populate this report.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Welder</TableHead>
              <TableHead>Employee #</TableHead>
              <TableHead>Trade</TableHead>
              <TableHead>Certifications & WPQs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {welders.map(({ person, tradeName, skills }) => (
              <TableRow key={person.id}>
                <TableCell>
                  <Link
                    href={`/training/transcripts/${person.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {person.lastName}, {person.firstName}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-600">
                  {person.employeeNo ?? '—'}
                </TableCell>
                <TableCell className="text-slate-600">{tradeName ?? '—'}</TableCell>
                <TableCell>
                  {skills.length === 0 ? (
                    <span className="text-xs text-slate-400">
                      No certifications on file
                    </span>
                  ) : (
                    <ul className="space-y-1.5">
                      {skills.map(({ assignment, type, authority }) => {
                        const isCwb = /cwb|canadian welding/i.test(authority.name)
                        const expired = assignment.expiresOn
                          ? assignment.expiresOn < today
                          : false
                        return (
                          <li key={assignment.id} className="text-xs">
                            <span className="font-medium text-slate-900">{type.name}</span>
                            {type.code ? (
                              <span className="ml-1 text-slate-500 font-mono">
                                ({type.code})
                              </span>
                            ) : null}
                            <span className="ml-2 text-slate-500">{authority.name}</span>
                            <span className="ml-2 text-slate-500">
                              · granted {assignment.grantedOn}
                            </span>
                            {assignment.expiresOn ? (
                              <span className="ml-2 text-slate-500">
                                · expires {assignment.expiresOn}
                              </span>
                            ) : null}
                            {assignment.notes ? (
                              <span className="ml-2 text-slate-500 italic">
                                — {assignment.notes}
                              </span>
                            ) : null}
                            {' '}
                            {isCwb ? (
                              <Badge variant="default" className="ml-1">
                                CWB
                              </Badge>
                            ) : null}
                            {expired ? (
                              <Badge variant="destructive" className="ml-1">
                                Expired
                              </Badge>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}

