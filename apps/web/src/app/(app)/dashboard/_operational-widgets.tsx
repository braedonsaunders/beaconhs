import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, CalendarClock, GraduationCap, MapPin, ShieldCheck } from 'lucide-react'
import { Badge } from '@beaconhs/ui'
import type { RequestContext } from '@beaconhs/tenant'
import { GeneratedValue } from '@/i18n/generated'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { EquipmentTelemetryMap } from '@/components/equipment-telemetry-map'
import { parseListParams, pickString } from '@/lib/list-params'
import { formatDate } from '@/lib/datetime'
import { loadEquipmentMap, equipmentMapPoints } from '@/lib/equipment/map-data'
import { TELEMETRY_HEALTH_LABELS } from '@/lib/equipment/telemetry'
import { listDueSignals, type SignalStatus } from '@/lib/operational-due'
import { obligationOverview } from '../compliance/_hub'
import { WIDGETS } from './_widget-registry'
import { canSeeWidget } from './_widget-access'
import { WidgetRefresh } from './_widget-refresh'

type SearchParams = Record<string, string | string[] | undefined>
const CONFIG = {
  'skills-expiring-tickets': {
    prefix: 'skillTickets',
    href: '/training/skills',
    icon: GraduationCap,
  },
  'skills-requirements': {
    prefix: 'skillRequirements',
    href: '/compliance?kind=skill_requirement',
    icon: ShieldCheck,
  },
  'equipment-maintenance-agenda': {
    prefix: 'equipmentAgenda',
    href: '/equipment/maintenance',
    icon: CalendarClock,
  },
  'equipment-gps-map': { prefix: 'equipmentMap', href: '/equipment/map', icon: MapPin },
} as const

export function isOperationalWidget(id: string): id is keyof typeof CONFIG {
  return Object.hasOwn(CONFIG, id)
}

/** Only placed/authorized cards execute queries; the edit palette shares this renderer. */
export async function OperationalWidget({
  id,
  ctx,
  sp = {},
  edit = false,
  basePath,
}: {
  id: keyof typeof CONFIG
  ctx: RequestContext
  sp?: SearchParams
  edit?: boolean
  basePath?: string
}) {
  if (!canSeeWidget(ctx, id)) return null
  const t = await getGeneratedValueTranslations()
  const { prefix, href, icon: Icon } = CONFIG[id]
  const pageKey = `${prefix}Page`
  const qKey = `${prefix}Q`
  const filterKey = `${prefix}Filter`
  const statusKey = `${prefix}Status`
  const base = basePath ?? (edit ? '/dashboard/customize' : '/dashboard')
  const params = parseListParams(
    { q: sp[qKey], page: sp[pageKey] },
    {
      sort: 'due',
      dir: 'asc',
      allowedSorts: ['due'],
      perPage: id === 'equipment-gps-map' ? 100 : 5,
    },
  )
  const filter = pickString(sp[filterKey])
  const status = pickString(sp[statusKey])
  const filterControl = (
    label: string,
    options: { value: string; label: string }[],
    key = filterKey,
  ) => (
    <FilterChips
      basePath={base}
      currentParams={sp}
      paramKey={key}
      pageParamKey={pageKey}
      label={label}
      options={options}
    />
  )
  const search = (
    <SearchInput
      className="relative min-w-32 flex-1"
      paramKey={qKey}
      pageParamKey={pageKey}
      searchLabel={t(WIDGETS[id]!.label)}
      placeholder={t('Search…')}
    />
  )
  const pager = (total: number, page = params.page) => (
    <Pagination
      basePath={base}
      currentParams={sp}
      pageParamKey={pageKey}
      total={total}
      page={page}
      perPage={params.perPage}
    />
  )
  const empty = (
    <p className="p-5 text-center text-sm text-slate-500">
      <GeneratedValue value="No items match these filters." />
    </p>
  )
  let content: ReactNode
  if (id === 'equipment-gps-map') {
    const data = await loadEquipmentMap(ctx, params, {
      health: filter,
      motion: pickString(sp[statusKey]),
    })
    const points = equipmentMapPoints(data, ctx)
    content = (
      <>
        {!edit ? <WidgetRefresh /> : null}
        <div className="flex flex-wrap gap-2 px-4 py-2">
          {search}
          {filterControl(
            'Tracker health',
            Object.entries(TELEMETRY_HEALTH_LABELS).map(([value, label]) => ({ value, label })),
          )}
          {filterControl(
            'Movement',
            [
              { value: 'moving', label: 'Moving' },
              { value: 'stationary', label: 'Stationary' },
            ],
            statusKey,
          )}
        </div>
        <div className="min-h-48 flex-1 px-3">
          {points.length ? (
            <EquipmentTelemetryMap points={points} embedded />
          ) : (
            <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 dark:border-slate-700">
              <GeneratedValue value="No positions to show" />
            </div>
          )}
        </div>
        <p className="px-4 pt-2 text-xs text-slate-500">
          <GeneratedValue value="Latest synced GPS. This widget refreshes every minute; the connector follows its configured schedule." />
        </p>
        {pager(data.total)}
      </>
    )
  } else if (id === 'skills-requirements') {
    const data = await obligationOverview(ctx, {
      ...params,
      kind: 'skill_requirement',
      needsAttention: filter === 'attention',
    })
    content = (
      <>
        <div className="flex flex-wrap gap-2 px-4 py-2">
          {search}
          {filterControl('View', [{ value: 'attention', label: 'Needs attention' }])}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4">
          {data.rows.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.rows.map((row) => (
                <li key={row.id} className="py-3">
                  <Link
                    href={`/compliance/obligations/${row.id}`}
                    className="block text-sm font-medium break-words text-slate-900 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-300"
                  >
                    {row.title}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>
                      <GeneratedValue value="Completed" /> {row.completed}/{row.total}
                    </span>
                    <span className={row.overdue ? 'text-amber-700 dark:text-amber-300' : ''}>
                      <GeneratedValue value="Overdue / expiring" /> {row.overdue}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                    aria-label={t('Completed')}
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={row.percent}
                  >
                    <div
                      className="h-full rounded-full bg-teal-600"
                      style={{ width: `${row.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            empty
          )}
        </div>
        {pager(data.total, data.page)}
      </>
    )
  } else {
    const equipment = id === 'equipment-maintenance-agenda'
    const families = ['Inspection', 'Reminder', 'Oil change', 'Warranty', 'Work order']
    const validStatus = ['overdue', 'expired', 'due_soon', 'open'].includes(status ?? '')
      ? (status as SignalStatus)
      : undefined
    const data = await listDueSignals(ctx, {
      ...params,
      module: equipment ? 'equipment' : 'skills',
      family: equipment && families.includes(filter ?? '') ? filter : undefined,
      status: validStatus,
      sort: 'due',
    })
    content = (
      <>
        <p className="px-4 pt-1 text-xs text-slate-500">
          <GeneratedValue value="Next 30 days and outstanding items" />
        </p>
        <div className="flex flex-wrap gap-2 px-4 py-2">
          {search}
          {equipment
            ? filterControl(
                'Type',
                families.map((label) => ({ value: label, label })),
              )
            : null}
          {filterControl(
            'Status',
            equipment
              ? [
                  { value: 'overdue', label: 'Overdue' },
                  { value: 'due_soon', label: 'Due soon' },
                  { value: 'expired', label: 'Expired' },
                  { value: 'open', label: 'Open' },
                ]
              : [
                  { value: 'expired', label: 'Expired' },
                  { value: 'due_soon', label: 'Due soon' },
                ],
            statusKey,
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4">
          {data.rows.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.rows.map((row) => (
                <li key={row.key} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={row.href ?? href}
                      className="min-w-0 text-sm font-medium break-words text-slate-900 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-300"
                    >
                      {row.subject}
                    </Link>
                    <Badge
                      variant={
                        row.status === 'expired' || row.status === 'overdue'
                          ? 'destructive'
                          : row.status === 'due_soon'
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      <GeneratedValue
                        value={
                          row.status === 'due_soon'
                            ? 'Due soon'
                            : row.status === 'overdue'
                              ? 'Overdue'
                              : row.status === 'expired'
                                ? 'Expired'
                                : 'Open'
                        }
                      />
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    {equipment ? (
                      <span>
                        <GeneratedValue value={row.family} />
                      </span>
                    ) : null}
                    {row.personName ? <span>{row.personName}</span> : null}
                    {row.dueOn ? (
                      <time dateTime={row.dueOn}>
                        {formatDate(new Date(`${row.dueOn}T00:00:00Z`), 'UTC', ctx.locale)}
                      </time>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            empty
          )}
        </div>
        {pager(data.total)}
      </>
    )
  }
  return (
    <section
      data-widget={id}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Icon size={16} className="shrink-0 text-teal-600 dark:text-teal-400" />
          <GeneratedValue value={WIDGETS[id]!.label} />
        </h2>
        <Link
          href={href}
          className="flex shrink-0 items-center gap-1 text-xs text-teal-700 hover:underline dark:text-teal-400"
        >
          <GeneratedValue value="Open" />
          <ArrowUpRight size={13} />
        </Link>
      </header>
      {content}
    </section>
  )
}
