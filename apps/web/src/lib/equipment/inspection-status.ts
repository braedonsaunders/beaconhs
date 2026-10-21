import { sql } from 'drizzle-orm'
import {
  equipmentInspectionSchedules,
  equipmentItems,
  equipmentTypes,
  tenantNotificationPolicy,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { moduleScopeWhere } from '@beaconhs/tenant/visibility'

export type EquipmentInspectionStatus = 'overdue' | 'due_soon' | 'current' | 'not_configured'
export const EQUIPMENT_INSPECTION_STATUS_LABELS: Record<EquipmentInspectionStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  current: 'Current',
  not_configured: 'Not configured',
}
export async function listEquipmentInspectionStatus(
  ctx: RequestContext,
  options: {
    q?: string
    status?: EquipmentInspectionStatus
    page: number
    perPage: number
  },
) {
  return ctx.db(async (tx) => {
    const visibility = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const filters = [sql`true`]
    if (options.q)
      filters.push(sql`concat_ws(' ',name,asset_tag,type_name) ilike ${`%${options.q.trim()}%`}`)
    if (options.status) filters.push(sql`status = ${options.status}`)
    type Row = {
      id: string | null
      name: string
      asset_tag: string
      type_name: string | null
      next_due_on: string | null
      schedules: number
      status: EquipmentInspectionStatus
      total: number | string
      overdue: number | string
      due_soon: number | string
      current: number | string
      not_configured: number | string
    }
    const result = await tx.execute<Row>(sql`
      with clock as (select (now() at time zone coalesce((select ${tenantNotificationPolicy.scanTimezone} from ${tenantNotificationPolicy} where ${tenantNotificationPolicy.tenantId}=${ctx.tenantId}),'UTC'))::date as today),
      units as (
        select ${equipmentItems.id} as id,${equipmentItems.name} as name,${equipmentItems.assetTag} as asset_tag,${equipmentTypes.name} as type_name,
          min(${equipmentInspectionSchedules.nextDueOn}) as next_due_on,count(${equipmentInspectionSchedules.id})::int as schedules,
          case when count(${equipmentInspectionSchedules.id})=0 then 'not_configured'
            when min(${equipmentInspectionSchedules.nextDueOn})<clock.today then 'overdue'
            when count(${equipmentInspectionSchedules.id}) filter(where ${equipmentInspectionSchedules.nextDueOn} is null)>0 then 'not_configured'
            when min(${equipmentInspectionSchedules.nextDueOn})<=clock.today+30 then 'due_soon' else 'current' end as status
        from ${equipmentItems} cross join clock
        left join ${equipmentTypes} on ${equipmentTypes.id}=${equipmentItems.typeId} and ${equipmentTypes.tenantId}=${equipmentItems.tenantId}
        left join ${equipmentInspectionSchedules} on ${equipmentInspectionSchedules.equipmentItemId}=${equipmentItems.id}
          and ${equipmentInspectionSchedules.tenantId}=${equipmentItems.tenantId} and ${equipmentInspectionSchedules.isActive}=true
        where ${equipmentItems.tenantId}=${ctx.tenantId} and ${equipmentItems.deletedAt} is null and ${equipmentItems.isDraft}=false
          and ${equipmentItems.status} not in ('retired','lost') and (${visibility ?? sql`true`})
        group by ${equipmentItems.id},${equipmentTypes.name},clock.today
      ), filtered as (select * from units where ${sql.join(filters, sql` and `)}),
      totals as (select count(*) as total from filtered),
      counts as (select count(*) filter(where status='overdue') as overdue,count(*) filter(where status='due_soon') as due_soon,
        count(*) filter(where status='current') as current,count(*) filter(where status='not_configured') as not_configured from units),
      paged as (select * from filtered order by case status when 'overdue' then 0 when 'due_soon' then 1 when 'not_configured' then 2 else 3 end,next_due_on,name,id
        limit ${options.perPage} offset ${(options.page - 1) * options.perPage})
      select paged.*,totals.total,counts.* from totals cross join counts left join paged on true
    `)
    const rows = result
    const head = rows[0]
    return {
      rows: rows.filter((row) => row.id !== null),
      total: Number(head?.total ?? 0),
      counts: {
        overdue: Number(head?.overdue ?? 0),
        due_soon: Number(head?.due_soon ?? 0),
        current: Number(head?.current ?? 0),
        not_configured: Number(head?.not_configured ?? 0),
      },
    }
  })
}
