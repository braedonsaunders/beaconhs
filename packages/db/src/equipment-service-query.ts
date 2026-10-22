import { sql } from 'drizzle-orm'
import { equipmentItems, equipmentMeters, equipmentServicePlans } from './schema'
/** Same any/all conditions as evaluateServicePlan, applied before paging or dispatch limits. */
export function equipmentServiceDueSql(today: string, strict = false) {
  const current = sql`case when r.value->>'meter'='engine_hours' then ${equipmentItems.currentHours}
 when r.value->>'meter'='odometer' then ${equipmentItems.currentOdometer}
 else (select m.current_value from ${equipmentMeters} m where m.tenant_id=${equipmentServicePlans.tenantId} and m.equipment_item_id=${equipmentServicePlans.equipmentItemId} and m.id::text=r.value->>'meter') end`
  const calendarCompare = strict ? sql`<` : sql`<=`
  const meterCompare = strict ? sql`>` : sql`>=`
  const reached = sql`case when r.value->>'kind'='calendar' then (r.value->>'every') is not null and (r.value->>'dueOn')::date ${calendarCompare} ${today}::date
 when r.value->>'kind'='meter' then ${current} ${meterCompare} (r.value->>'dueAt')::numeric else false end`
  return sql`(${equipmentServicePlans.isActive} and case when ${equipmentServicePlans.match}='all'
 then not exists(select 1 from jsonb_array_elements(${equipmentServicePlans.rules}) r(value) where not coalesce((${reached}),false))
 else exists(select 1 from jsonb_array_elements(${equipmentServicePlans.rules}) r(value) where coalesce((${reached}),false)) end)`
}
