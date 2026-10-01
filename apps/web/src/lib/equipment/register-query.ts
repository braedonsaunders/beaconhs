import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  departments,
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { isUuid, parseListParams, pickString } from '../list-params'
import { EQUIPMENT_STATUSES } from './mutation-input'

const SORTS = [
  'asset_tag',
  'name',
  'category',
  'type',
  'department',
  'status',
  'site',
  'holder',
  'purchase_date',
] as const

/** The register and CSV export share exactly the same filters and ordering. */
export function equipmentRegisterQuery(
  sp: Record<string, string | string[] | undefined>,
  scope?: SQL<unknown>,
) {
  const params = parseListParams(sp, {
    sort: 'asset_tag',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusRaw = pickString(sp.status) ?? 'in_service'
  const statusFilter = statusRaw === 'all' ? undefined : statusRaw
  const availabilityFilter = pickString(sp.availability)
  const filters: SQL<unknown>[] = [isNull(equipmentItems.deletedAt)]
  if (scope) filters.push(scope)
  if (params.q) {
    const term = `%${params.q}%`
    filters.push(
      or(
        ilike(equipmentItems.assetTag, term),
        ilike(equipmentItems.name, term),
        ilike(equipmentItems.serialNumber, term),
        ilike(departments.name, term),
      )!,
    )
  }
  if (statusFilter) {
    const status = EQUIPMENT_STATUSES.find((s) => s === statusFilter)
    filters.push(status ? eq(equipmentItems.status, status) : sql`false`)
  }
  if (availabilityFilter === 'available' || availabilityFilter === 'checked_out') {
    filters.push(eq(equipmentItems.isAvailableForCheckout, availabilityFilter === 'available'))
  }
  for (const [key, column] of [
    ['type', equipmentItems.typeId],
    ['category', equipmentItems.categoryId],
    ['department', equipmentItems.departmentId],
    ['holder', equipmentItems.currentHolderPersonId],
  ] as const) {
    const value = pickString(sp[key])
    if (value) filters.push(isUuid(value) ? eq(column, value) : sql`false`)
  }
  const sortColumns = {
    asset_tag: equipmentItems.assetTag,
    name: equipmentItems.name,
    category: equipmentCategories.name,
    type: equipmentTypes.name,
    department: departments.name,
    status: equipmentItems.status,
    site: orgUnits.name,
    holder: people.lastName,
    purchase_date: equipmentItems.purchaseDate,
  }
  const dirFn = params.dir === 'asc' ? asc : desc
  const column = sortColumns[params.sort as keyof typeof sortColumns] ?? equipmentItems.assetTag
  return {
    params,
    statusRaw,
    statusFilter,
    where: and(...filters),
    orderBy: [dirFn(column), asc(equipmentItems.id)],
  }
}
