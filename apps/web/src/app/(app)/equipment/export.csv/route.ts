import type { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import {
  departments,
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import {
  CSV_EXPORT_QUERY_LIMIT,
  csvExportOverflowResponse,
  csvFilename,
  csvResponse,
} from '@/lib/csv'
import { csvColumns, selectCsvColumns } from '@/lib/export-columns'
import { equipmentRegisterQuery } from '@/lib/equipment/register-query'
import { isRouterPrefetch } from '@/lib/router-prefetch'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (isRouterPrefetch(req)) return new Response(null, { status: 204 })

  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const ctx = await requireExportContext()
  // Read-tier gate: must hold at least the site read tier (equipment has no
  // self tier), and the export is bounded to that tier so a site-scoped user
  // can't dump the whole tenant.
  assertCan(ctx, 'equipment.read.site')

  const rows = await ctx.db(async (tx) => {
    const scopeWhere = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const { where: whereClause, orderBy } = equipmentRegisterQuery(sp, scopeWhere)

    return tx
      .select({
        item: equipmentItems,
        department: departments,
        category: equipmentCategories,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
      })
      .from(equipmentItems)
      .leftJoin(
        departments,
        and(
          eq(departments.tenantId, equipmentItems.tenantId),
          eq(departments.id, equipmentItems.departmentId),
        ),
      )
      .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(CSV_EXPORT_QUERY_LIMIT)
  })

  const overflow = csvExportOverflowResponse(rows.length)
  if (overflow) return overflow

  await recordAudit(ctx, {
    entityType: 'equipment',
    action: 'export',
    summary: `Exported ${rows.length} equipment items to CSV`,
    metadata: { format: 'csv', filters: sp },
  })

  const columns = csvColumns([
    'Asset tag',
    'Name',
    'Category',
    'Type',
    'Department',
    'Serial #',
    'Status',
    'Missing',
    'Site',
    'Holder',
    'Purchase date',
  ])
  const selection = selectCsvColumns(url.searchParams, columns)

  return csvResponse({
    filename: csvFilename('equipment'),
    headers: selection.headers,
    rows: rows.map(({ item, category, type, department, site, holder }) =>
      selection.project([
        item.assetTag,
        item.name,
        category?.name ?? '',
        type?.name ?? '',
        department?.name ?? '',
        item.serialNumber ?? '',
        item.status,
        item.isMissing ? 'yes' : 'no',
        site?.name ?? '',
        holder ? `${holder.firstName} ${holder.lastName}` : '',
        item.purchaseDate ?? '',
      ]),
    ),
  })
}
