// CWB welder roster CSV. One row per (welder, certification) — flat, so the
// auditor's spreadsheet macros work without restructuring.

import { asc, eq, ilike, or, sql } from 'drizzle-orm'
import {
  people,
  trades,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { csvFilename, csvResponse } from '@/lib/csv'

export async function GET() {
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const data = await ctx.db(async (tx) => {
    const welderTrades = await tx
      .select()
      .from(trades)
      .where(ilike(trades.name, '%weld%'))
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

    if (byId.size === 0) return { rows: [] as (string | null)[][], all: 0 }

    const tradesById = new Map<string, string>()
    for (const t of welderTrades) tradesById.set(t.id, t.name)
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

    const rows: (string | null)[][] = []
    const welders = Array.from(byId.values()).sort((a, b) =>
      a.lastName.localeCompare(b.lastName),
    )
    for (const p of welders) {
      const skills = skillsByPerson.get(p.id) ?? []
      const tradeName = p.tradeId ? (tradesById.get(p.tradeId) ?? null) : null
      if (skills.length === 0) {
        rows.push([
          p.employeeNo ?? null,
          p.lastName,
          p.firstName,
          tradeName,
          null,
          null,
          null,
          null,
          null,
          'no_certs',
        ])
      } else {
        for (const s of skills) {
          const status = s.assignment.expiresOn
            ? s.assignment.expiresOn < today
              ? 'expired'
              : 'active'
            : 'active'
          rows.push([
            p.employeeNo ?? null,
            p.lastName,
            p.firstName,
            tradeName,
            s.authority.name,
            s.type.code ?? null,
            s.type.name,
            s.assignment.grantedOn,
            s.assignment.expiresOn ?? null,
            status,
          ])
        }
      }
    }
    return { rows, all: welders.length }
  })

  return csvResponse({
    filename: csvFilename('cwb-welder-report'),
    headers: [
      'Employee #',
      'Last name',
      'First name',
      'Trade',
      'Authority',
      'Certification code',
      'Certification name',
      'Granted on',
      'Expires on',
      'Status',
    ],
    rows: data.rows,
  })
}
