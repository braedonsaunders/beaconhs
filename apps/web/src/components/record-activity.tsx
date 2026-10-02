import { and, eq, inArray } from 'drizzle-orm'
import { people, tenantUsers, users, orgUnits, inspectionRecordCriteria } from '@beaconhs/db/schema'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import type { RequestContext } from '@beaconhs/tenant'
import { activityPageForEntity } from '@/lib/audit'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { ActivityFeed } from './activity-feed'
import { Pagination } from './pagination'
import { SearchInput } from './search-input'
import { FilterChips } from './filter-bar'

export async function RecordActivity({
  ctx,
  entityType,
  entityId,
  basePath,
  searchParams,
}: {
  ctx: RequestContext
  entityType: string
  entityId: string
  basePath: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const params = parseListParams(
    { page: searchParams.activityPage },
    { perPage: 25, sort: 'date', allowedSorts: ['date'] },
  )
  const data = await activityPageForEntity(ctx, entityType, entityId, {
    page: params.page,
    perPage: 25,
    q: pickString(searchParams.activitySearch),
    action: pickString(searchParams.activityAction),
  })
  const ids = new Set<string>()
  function collect(value: unknown): void {
    if (typeof value === 'string' && isUuid(value)) ids.add(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  for (const row of data.rows) {
    collect(row.before)
    collect(row.after)
  }
  const names = new Map<string, string>()
  if (ids.size)
    await ctx.db(async (tx) => {
      const keys = [...ids]
      const [persons, members, locations, findings] = await Promise.all([
        tx
          .select({ id: people.id, first: people.firstName, last: people.lastName })
          .from(people)
          .where(inArray(people.id, keys)),
        tx
          .select({ id: tenantUsers.id, name: users.name })
          .from(tenantUsers)
          .innerJoin(users, eq(users.id, tenantUsers.userId))
          .where(and(eq(tenantUsers.tenantId, ctx.tenantId), inArray(tenantUsers.id, keys))),
        tx
          .select({ id: orgUnits.id, name: orgUnits.name })
          .from(orgUnits)
          .where(inArray(orgUnits.id, keys)),
        tx
          .select({
            id: inspectionRecordCriteria.id,
            name: inspectionRecordCriteria.questionTextSnapshot,
          })
          .from(inspectionRecordCriteria)
          .where(
            and(
              eq(inspectionRecordCriteria.recordId, entityId),
              inArray(inspectionRecordCriteria.id, keys),
            ),
          ),
      ])
      for (const person of persons) names.set(person.id, `${person.first} ${person.last}`.trim())
      for (const row of [...members, ...locations, ...findings])
        if (row.name) names.set(row.id, row.name)
    })
  function readable(value: unknown): unknown {
    if (typeof value === 'string') return names.get(value) ?? value
    if (Array.isArray(value)) return value.map(readable)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, readable(v)]))
    return value
  }
  const entries = data.rows.map((row) => ({
    ...row,
    summary:
      typeof row.after?.rowId === 'string' && names.has(row.after.rowId)
        ? `${row.summary ?? row.action} — ${names.get(row.after.rowId)}`
        : row.summary,
    before: readable(row.before) as typeof row.before,
    after: readable(row.after) as typeof row.after,
  }))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <SearchInput
          placeholder={tGeneratedValue('Search activity…')}
          paramKey="activitySearch"
          pageParamKey="activityPage"
        />
        <FilterChips
          basePath={basePath}
          currentParams={searchParams}
          paramKey="activityAction"
          pageParamKey="activityPage"
          label={tGeneratedValue('Action')}
          options={data.actions.map((a) => ({
            value: a.action,
            label: a.action.replace(/_/g, ' '),
            count: a.count,
          }))}
        />
      </div>
      <ActivityFeed entries={entries} timeZone={ctx.timezone} locale={ctx.locale} />
      <Pagination
        basePath={basePath}
        currentParams={searchParams}
        pageParamKey="activityPage"
        page={params.page}
        perPage={25}
        total={data.filteredTotal}
      />
    </div>
  )
}
