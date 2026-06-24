import type { NextRequest } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { equipmentItems, equipmentTypes, orgUnits, people } from '@beaconhs/db/schema'
import { requireExportContext } from '@/lib/auth'
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
  const today = new Date().toISOString().slice(0, 10)

  const ctx = await requireExportContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({ item: equipmentItems, type: equipmentTypes, site: orgUnits, holder: people })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .where(
        sql`${equipmentItems.requiresOilChange} = true AND (
          ${equipmentItems.nextOilChangeDue} IS NULL OR
          ${equipmentItems.nextOilChangeDue} <= ${horizonIso}::date
        )`,
      )
      .orderBy(asc(equipmentItems.nextOilChangeDue)),
  )

  return csvResponse({
    filename: csvFilename('upcoming-oil-changes'),
    headers: [
      'Asset tag',
      'Name',
      'Type',
      'Site',
      'Holder',
      'Last oil change',
      'Next due',
      'Interval (months)',
      'Status',
    ],
    rows: rows.map(({ item, type, site, holder }) => [
      item.assetTag,
      item.name,
      type?.name ?? '',
      site?.name ?? '',
      holder ? `${holder.firstName} ${holder.lastName}` : '',
      item.lastOilChangeOn ?? '',
      item.nextOilChangeDue ?? '',
      item.oilChangeIntervalMonths ?? '',
      item.nextOilChangeDue && item.nextOilChangeDue < today
        ? 'overdue'
        : item.nextOilChangeDue
          ? 'upcoming'
          : 'unscheduled',
    ]),
  })
}
