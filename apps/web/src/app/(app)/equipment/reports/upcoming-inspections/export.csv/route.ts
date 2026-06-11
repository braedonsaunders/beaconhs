import type { NextRequest } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { equipmentItems, equipmentTypes, orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { csvFilename, csvResponse } from '@/lib/csv'
import { pickString } from '@/lib/list-params'

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const days = Number(pickString(sp.days) ?? '30')
  const horizon = new Date()
  horizon.setDate(
    horizon.getDate() + (Number.isFinite(days) ? Math.max(1, Math.min(180, days)) : 30),
  )
  const horizonIso = horizon.toISOString().slice(0, 10)

  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .where(
        sql`${equipmentItems.requiresAnnualInspection} = true AND (
          ${equipmentItems.nextAnnualInspectionDue} IS NULL OR
          ${equipmentItems.nextAnnualInspectionDue} <= ${horizonIso}::date
        )`,
      )
      .orderBy(asc(equipmentItems.nextAnnualInspectionDue)),
  )
  const today = new Date().toISOString().slice(0, 10)

  return csvResponse({
    filename: csvFilename('upcoming-inspections'),
    headers: ['Asset tag', 'Name', 'Type', 'Site', 'Holder', 'Last annual', 'Next due', 'Status'],
    rows: rows.map(({ item, type, site, holder }) => [
      item.assetTag,
      item.name,
      type?.name ?? '',
      site?.name ?? '',
      holder ? `${holder.firstName} ${holder.lastName}` : '',
      item.lastAnnualInspectionOn ?? '',
      item.nextAnnualInspectionDue ?? '',
      item.nextAnnualInspectionDue && item.nextAnnualInspectionDue < today
        ? 'overdue'
        : item.nextAnnualInspectionDue
          ? 'upcoming'
          : 'unscheduled',
    ]),
  })
}
