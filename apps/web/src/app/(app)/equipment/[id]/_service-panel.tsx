import Link from 'next/link'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { and, asc, count, eq, ilike, or } from 'drizzle-orm'
import { equipmentItems, equipmentMeters, equipmentServicePlans } from '@beaconhs/db/schema'
import { evaluateServicePlan } from '@beaconhs/db/equipment-service'
import { Badge, Button, Card, CardHeader, CardTitle, CardContent } from '@beaconhs/ui'
import { GeneratedValue } from '@/i18n/generated'
import { requireRequestContext } from '@/lib/auth'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { mergeHref, pickString } from '@/lib/list-params'
import { ServiceDrawers, ServiceCounters } from './_service-drawers'
import { formatInterval } from '@/lib/equipment/intervals'
export async function ServicePanel({
  item,
  sp,
  today,
  canEdit,
}: {
  item: typeof equipmentItems.$inferSelect
  sp: Record<string, string | string[] | undefined>
  today: string
  canEdit: boolean
}) {
  const ctx = await requireRequestContext()
  const t = await getGeneratedValueTranslations()
  const q = pickString(sp.svc_q) ?? ''
  const page = Math.max(1, Math.floor(Number(pickString(sp.svc_page)) || 1))
  const active = pickString(sp.svc_status) ?? 'active'
  const where = and(
    eq(equipmentServicePlans.equipmentItemId, item.id),
    q
      ? or(
          ilike(equipmentServicePlans.name, `%${q}%`),
          ilike(equipmentServicePlans.notes, `%${q}%`),
        )
      : undefined,
    active === 'all' ? undefined : eq(equipmentServicePlans.isActive, active !== 'paused'),
  )
  const { plans, total, meters, editing } = await ctx.db(async (tx) => {
    const [plans, totals, meters] = await Promise.all([
      tx
        .select()
        .from(equipmentServicePlans)
        .where(where)
        .orderBy(asc(equipmentServicePlans.name), asc(equipmentServicePlans.id))
        .limit(10)
        .offset((page - 1) * 10),
      tx.select({ n: count() }).from(equipmentServicePlans).where(where),
      tx
        .select()
        .from(equipmentMeters)
        .where(eq(equipmentMeters.equipmentItemId, item.id))
        .orderBy(asc(equipmentMeters.name)),
    ])
    const editId = pickString(sp.serviceId)
    const [editing] =
      editId && /^[0-9a-f-]{36}$/i.test(editId)
        ? await tx
            .select()
            .from(equipmentServicePlans)
            .where(
              and(
                eq(equipmentServicePlans.id, editId),
                eq(equipmentServicePlans.equipmentItemId, item.id),
              ),
            )
            .limit(1)
        : []
    return { plans, total: Number(totals[0]?.n ?? 0), meters, editing: editing ?? null }
  })
  const meterOptions = meters.map((m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    value: m.currentValue === null ? null : Number(m.currentValue),
  }))
  const readings: Record<string, number | null> = {
    engine_hours: item.currentHours === null ? null : Number(item.currentHours),
    odometer: item.currentOdometer,
    ...Object.fromEntries(meterOptions.map((m) => [m.id, m.value])),
  }
  const basePath = `/equipment/${item.id}`
  const closeHref = mergeHref(basePath, sp, {
    tab: 'inspections',
    itab: 'maintenance',
    drawer: undefined,
    serviceId: undefined,
  })
  const href = (drawer: string, id?: string) =>
    mergeHref(basePath, sp, { tab: 'inspections', itab: 'maintenance', drawer, serviceId: id })
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>
            <GeneratedValue value="Periodic maintenance" />
          </CardTitle>
          {canEdit ? (
            <Button asChild size="sm">
              <Link href={href('service-new') as never}>
                <GeneratedValue value="Add maintenance" />
              </Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500">
            <GeneratedValue value="Track servicing by time, hours, distance, or custom usage counters. Record the work when it is completed; reminders are managed separately." />
          </p>
          <div className="flex flex-wrap gap-3">
            <SearchInput
              paramKey="svc_q"
              pageParamKey="svc_page"
              placeholder={t('Search maintenance')}
            />
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="svc_status"
              pageParamKey="svc_page"
              label={t('Status')}
              allLabel="All"
              defaultValue="active"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'paused', label: 'Paused' },
              ]}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="px-3 py-2">
                    <GeneratedValue value="Maintenance" />
                  </th>
                  <th className="px-3 py-2">
                    <GeneratedValue value="Next due" />
                  </th>
                  <th className="px-3 py-2">
                    <GeneratedValue value="Last completed" />
                  </th>
                  <th className="px-3 py-2">
                    <GeneratedValue value="Status" />
                  </th>
                  <th className="px-3 py-2">
                    <span className="sr-only">
                      <GeneratedValue value="Actions" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => {
                  const state = evaluateServicePlan(plan, readings, today)
                  return (
                    <tr key={plan.id} className="border-b align-top">
                      <td className="px-3 py-3">
                        <p className="font-medium">{plan.name}</p>
                        <p className="text-xs text-slate-500">
                          {plan.rules.length > 1 ? (
                            <GeneratedValue
                              value={
                                plan.match === 'any'
                                  ? 'Whichever comes first'
                                  : 'When all conditions are met'
                              }
                            />
                          ) : null}
                        </p>
                      </td>
                      <td className="space-y-1 px-3 py-3">
                        {plan.rules.map((r, i) => (
                          <div key={i} className="text-xs">
                            {r.kind === 'calendar' ? (
                              <>
                                <GeneratedValue value={formatInterval(r.every, r.unit)} /> ·{' '}
                                {r.dueOn ?? <GeneratedValue value="Needs setup" />}
                              </>
                            ) : (
                              <>
                                {r.meter === 'engine_hours' ? (
                                  <GeneratedValue value="Engine hours" />
                                ) : r.meter === 'odometer' ? (
                                  <GeneratedValue value="Odometer" />
                                ) : (
                                  (meterOptions.find((m) => m.id === r.meter)?.name ?? '—')
                                )}{' '}
                                · {r.dueAt ?? <GeneratedValue value="Needs setup" />} (
                                {readings[r.meter] ?? '—'} <GeneratedValue value="current" />)
                              </>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{plan.lastCompletedOn ?? '—'}</td>
                      <td className="px-3 py-3">
                        <Badge
                          className="whitespace-nowrap"
                          variant={state.due ? 'warning' : 'secondary'}
                        >
                          <GeneratedValue
                            value={
                              {
                                paused: 'Paused',
                                needs_setup: 'Needs setup',
                                upcoming: 'Upcoming',
                                due: 'Due',
                                overdue: 'Overdue',
                              }[state.status]
                            }
                          />
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        {canEdit ? (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" asChild>
                              <Link href={href('service-edit', plan.id) as never}>
                                <GeneratedValue value="Edit" />
                              </Link>
                            </Button>
                            {plan.isActive ? (
                              <Button size="sm" asChild>
                                <Link href={href('service-complete', plan.id) as never}>
                                  <GeneratedValue value="Record completed" />
                                </Link>
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!plans.length ? (
            <p className="py-6 text-center text-sm text-slate-500">
              <GeneratedValue
                value={
                  q
                    ? 'No maintenance matches this search.'
                    : 'No periodic maintenance has been added.'
                }
              />
            </p>
          ) : null}
          <Pagination
            basePath={basePath}
            currentParams={sp}
            page={page}
            total={total}
            perPage={10}
            pageParamKey="svc_page"
          />
        </CardContent>
      </Card>
      {canEdit ? (
        <ServiceCounters
          itemId={item.id}
          today={today}
          meters={meterOptions}
          readings={readings}
          currentParams={sp}
        />
      ) : null}
      {canEdit ? (
        <ServiceDrawers
          itemId={item.id}
          today={today}
          closeHref={closeHref}
          drawer={pickString(sp.drawer)}
          editing={editing}
          meters={meterOptions}
          readings={readings}
        />
      ) : null}
    </div>
  )
}
