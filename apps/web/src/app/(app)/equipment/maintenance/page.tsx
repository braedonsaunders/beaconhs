import Link from 'next/link'
import { and, asc, eq, isNotNull, isNull, notInArray, or } from 'drizzle-orm'
import {
  AlarmClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Settings2,
  Plus,
  Wrench,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  UrlDrawer,
} from '@beaconhs/ui'
import {
  equipmentCategories,
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentReminders,
  equipmentServicePlans,
  equipmentMeters,
  equipmentWorkOrders,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { evaluateServicePlan } from '@beaconhs/db/equipment-service'
import { assertCan, can } from '@beaconhs/tenant'
import type { AppLocale } from '@beaconhs/i18n'
import { moduleScopeWhere } from '@beaconhs/tenant/visibility'
import { htmlToSnippet } from '@beaconhs/forms-core'
import { complianceDate, resolveComplianceClock } from '@beaconhs/compliance'
import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { requireRequestContext } from '@/lib/auth'
import { clamp, isUuid, mergeHref, pickString } from '@/lib/list-params'
import { formatDate } from '@/lib/datetime'
import { formatInterval } from '@/lib/equipment/intervals'
import {
  addMaintenanceDays as addDays,
  maintenanceMatchesPeriod,
  sortMaintenanceEntries,
  type MaintenanceEntry as Entry,
  type MaintenanceKind as EntryKind,
} from '@/lib/equipment/maintenance-agenda'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { TableToolbar } from '@/components/table-toolbar'
import { FilterChips } from '@/components/filter-bar'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { StatTile } from '@/components/stat-tile'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { EquipmentInspectionDrawer } from '../inspections/_inspection-panel'
import { StartInspectionButton } from '../inspections/_start-button'
import { completeEquipmentReminder } from '../_maintenance-actions'
import { ReminderDrawer, type ReminderEditing } from '../_maintenance-drawers'
import { CompleteSchedule } from '../_complete-schedule'

export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('Equipment maintenance') }
}

const BASE = '/equipment/maintenance'
const PER_PAGE = 15
const KIND_META: Record<EntryKind, { label: string; dot: string }> = {
  inspection: { label: 'Inspection', dot: 'bg-teal-500' },
  reminder: { label: 'Reminder', dot: 'bg-amber-500' },
  service: { label: 'Periodic maintenance', dot: 'bg-violet-500' },
  warranty: { label: 'Warranty', dot: 'bg-sky-500' },
  work_order: { label: 'Work order', dot: 'bg-rose-500' },
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export default async function EquipmentMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.read.self')
  const manage = can(ctx, 'equipment.manage')
  const inspect = can(ctx, 'equipment.inspect')
  const createWorkOrder = can(ctx, 'equipment.workorder.create')
  const today = complianceDate(await ctx.db((tx) => resolveComplianceClock(tx, ctx.tenantId)))
  const currentMonth = today.slice(0, 7)
  const rawMonth = pickString(sp.month)
  const month =
    rawMonth && /^(19[0-9]{2}|[2-9][0-9]{3})-(0[1-9]|1[0-2])$/.test(rawMonth)
      ? rawMonth
      : currentMonth
  const monthStart = `${month}-01`
  const monthStartDate = new Date(`${monthStart}T00:00:00Z`)
  const monthEndDate = new Date(monthStartDate)
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1)
  monthEndDate.setUTCDate(0)
  const monthEnd = isoDate(monthEndDate)
  const prevMonth = isoDate(
    new Date(Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() - 1, 1)),
  ).slice(0, 7)
  const nextMonth = isoDate(
    new Date(Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() + 1, 1)),
  ).slice(0, 7)
  const kindFilter = pickString(sp.kind)
  const rawCategory = pickString(sp.cat)
  const catFilter = rawCategory && isUuid(rawCategory) ? rawCategory : undefined
  const rawPeriod = pickString(sp.due)
  const period = ['ready', 'overdue', 'today', 'week', 'month', 'undated'].includes(rawPeriod ?? '')
    ? rawPeriod
    : undefined
  const q = pickString(sp.q)?.trim().toLowerCase()
  const view = pickActiveTab(sp, ['list', 'calendar'] as const, 'list', 'view')
  const drawerKey = pickString(sp.drawer)
  const drawerDayRaw = drawerKey?.startsWith('day-') ? drawerKey.slice(4) : null
  const drawerDate = drawerDayRaw ? new Date(`${drawerDayRaw}T00:00:00Z`) : null
  const drawerDay =
    drawerDayRaw &&
    /^\d{4}-\d{2}-\d{2}$/.test(drawerDayRaw) &&
    drawerDate &&
    !Number.isNaN(drawerDate.valueOf()) &&
    isoDate(drawerDate) === drawerDayRaw
      ? drawerDayRaw
      : null
  const closeHref = mergeHref(BASE, sp, {
    drawer: undefined,
    inspectionId: undefined,
    workOrderId: undefined,
    dayPage: undefined,
  })

  const data = await ctx.db(async (tx) => {
    const visibility = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const workOrderVisibility = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      ownerCols: [
        equipmentWorkOrders.openedByTenantUserId,
        equipmentWorkOrders.assignedToTenantUserId,
      ],
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentWorkOrders.reportedByPersonId,
    })
    const itemFilters = [
      isNull(equipmentItems.deletedAt),
      notInArray(equipmentItems.status, ['retired', 'lost']),
      visibility,
      catFilter ? eq(equipmentItems.categoryId, catFilter) : undefined,
    ]
    const itemFields = {
      itemId: equipmentItems.id,
      itemName: equipmentItems.name,
      assetTag: equipmentItems.assetTag,
    }
    // Load all active dates: the work list must not silently drop future reminders.
    const [
      scheduleRows,
      reminderRows,
      serviceRows,
      warrantyRows,
      workOrderRows,
      categories,
      meters,
    ] = await Promise.all([
      tx
        .select({
          schedule: equipmentInspectionSchedules,
          typeName: equipmentInspectionTypes.name,
          ...itemFields,
        })
        .from(equipmentInspectionSchedules)
        .innerJoin(
          equipmentItems,
          eq(equipmentItems.id, equipmentInspectionSchedules.equipmentItemId),
        )
        .leftJoin(
          equipmentInspectionTypes,
          eq(equipmentInspectionTypes.id, equipmentInspectionSchedules.inspectionTypeId),
        )
        .where(
          and(
            eq(equipmentInspectionSchedules.isActive, true),
            or(isNull(equipmentInspectionTypes.id), eq(equipmentInspectionTypes.isPreUse, false)),
            ...itemFilters,
          ),
        ),
      tx
        .select({ reminder: equipmentReminders, assignee: people, ...itemFields })
        .from(equipmentReminders)
        .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentReminders.equipmentItemId))
        .leftJoin(people, eq(people.id, equipmentReminders.assignedToPersonId))
        .where(and(isNull(equipmentReminders.completedAt), ...itemFilters)),
      tx
        .select({
          plan: equipmentServicePlans,
          currentHours: equipmentItems.currentHours,
          currentOdometer: equipmentItems.currentOdometer,
          ...itemFields,
        })
        .from(equipmentServicePlans)
        .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentServicePlans.equipmentItemId))
        .where(and(eq(equipmentServicePlans.isActive, true), ...itemFilters)),
      tx
        .select({ dueOn: equipmentItems.warrantyExpiresOn, ...itemFields })
        .from(equipmentItems)
        .where(and(isNotNull(equipmentItems.warrantyExpiresOn), ...itemFilters)),
      tx
        .select({
          wo: equipmentWorkOrders,
          assigneeName: users.name,
          assigneeDisplayName: tenantUsers.displayName,
          ...itemFields,
        })
        .from(equipmentWorkOrders)
        .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
        .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentWorkOrders.assignedToTenantUserId))
        .leftJoin(users, eq(users.id, tenantUsers.userId))
        .where(
          and(
            isNull(equipmentWorkOrders.deletedAt),
            isNull(equipmentItems.deletedAt),
            notInArray(equipmentWorkOrders.status, ['closed', 'cancelled']),
            workOrderVisibility,
            catFilter ? eq(equipmentItems.categoryId, catFilter) : undefined,
          ),
        ),
      tx
        .select({ id: equipmentCategories.id, name: equipmentCategories.name })
        .from(equipmentCategories)
        .orderBy(asc(equipmentCategories.sortOrder), asc(equipmentCategories.name)),
      tx
        .select({ meter: equipmentMeters })
        .from(equipmentMeters)
        .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentMeters.equipmentItemId))
        .where(and(...itemFilters)),
    ])
    return {
      scheduleRows,
      reminderRows,
      serviceRows,
      warrantyRows,
      workOrderRows,
      categories,
      meters,
    }
  })

  const metersByItem = new Map<string, (typeof data.meters)[number]['meter'][]>()
  for (const { meter } of data.meters) {
    const meters = metersByItem.get(meter.equipmentItemId) ?? []
    meters.push(meter)
    metersByItem.set(meter.equipmentItemId, meters)
  }
  const allEntries: Entry[] = [
    ...data.scheduleRows.map((r): Entry => ({
      key: `s-${r.schedule.id}`,
      kind: 'inspection',
      itemId: r.itemId,
      itemName: r.itemName,
      assetTag: r.assetTag,
      title: r.typeName ?? r.schedule.label ?? 'Inspection',
      detail: formatInterval(r.schedule.intervalValue, r.schedule.intervalUnit),
      dueOn: r.schedule.nextDueOn,
      startTypeId: r.schedule.inspectionTypeId,
      scheduleId: r.schedule.id,
    })),
    ...data.reminderRows.map((r): Entry => ({
      key: `r-${r.reminder.id}`,
      kind: 'reminder',
      itemId: r.itemId,
      itemName: r.itemName,
      assetTag: r.assetTag,
      title: r.reminder.title,
      detail: [
        r.assignee ? `${r.assignee.firstName} ${r.assignee.lastName}` : null,
        r.reminder.repeatIntervalValue && r.reminder.repeatIntervalUnit
          ? formatInterval(r.reminder.repeatIntervalValue, r.reminder.repeatIntervalUnit)
          : null,
        htmlToSnippet(r.reminder.details ?? ''),
      ]
        .filter(Boolean)
        .join(' · '),
      dueOn: r.reminder.dueOn,
      reminderId: r.reminder.id,
    })),
    ...data.serviceRows.map((r): Entry => {
      const itemMeters = metersByItem.get(r.itemId) ?? []
      const readings: Record<string, number | null> = {
        engine_hours: r.currentHours === null ? null : Number(r.currentHours),
        odometer: r.currentOdometer,
        ...Object.fromEntries(
          itemMeters.map((m) => [m.id, m.currentValue === null ? null : Number(m.currentValue)]),
        ),
      }
      const state = evaluateServicePlan(r.plan, readings, today)
      return {
        key: `service-${r.plan.id}`,
        kind: 'service',
        itemId: r.itemId,
        itemName: r.itemName,
        assetTag: r.assetTag,
        title: r.plan.name,
        servicePlanId: r.plan.id,
        serviceStatus: state.status,
        dueOn: state.dueOn,
        detail: r.plan.rules
          .map((rule) =>
            rule.kind === 'calendar'
              ? `${rule.every && rule.unit ? formatInterval(rule.every, rule.unit) : tGeneratedValue('Needs setup')} · ${rule.dueOn ?? tGeneratedValue('Needs setup')}`
              : `${rule.meter === 'engine_hours' ? tGeneratedValue('Engine hours') : rule.meter === 'odometer' ? tGeneratedValue('Odometer') : (itemMeters.find((m) => m.id === rule.meter)?.name ?? '—')}: ${readings[rule.meter] ?? '—'} (${tGeneratedValue('Due')}: ${rule.dueAt ?? '—'})`,
          )
          .join(' · '),
      }
    }),
    ...data.warrantyRows
      .filter((r) => r.dueOn !== null && r.dueOn >= today)
      .map((r): Entry => ({
        key: `w-${r.itemId}`,
        kind: 'warranty',
        itemId: r.itemId,
        itemName: r.itemName,
        assetTag: r.assetTag,
        title: 'Warranty expires',
        detail: null,
        dueOn: r.dueOn,
      })),
    ...data.workOrderRows.map((r): Entry => ({
      key: `wo-${r.wo.id}`,
      kind: 'work_order',
      itemId: r.itemId,
      itemName: r.itemName,
      assetTag: r.assetTag,
      title: `${r.wo.reference} · ${htmlToSnippet(r.wo.summary)}`,
      detail: r.assigneeName ?? r.assigneeDisplayName ?? 'Unassigned',
      dueOn: null,
      workOrderId: r.wo.id,
      status: r.wo.status,
      priority: r.wo.priority,
      openedOn: r.wo.openedAt.toISOString(),
    })),
  ]
  const entries = sortMaintenanceEntries(
    allEntries.filter(
      (e) =>
        (!kindFilter || e.kind === kindFilter) &&
        (!q ||
          [e.itemName, e.assetTag, e.title, e.detail, e.status?.replaceAll('_', ' ')].some(
            (value) => value?.toLowerCase().includes(q),
          )),
    ),
    today,
  )
  const overdue = entries.filter((e) => maintenanceMatchesPeriod(e, 'overdue', today, month))
  const dueToday = entries.filter((e) => maintenanceMatchesPeriod(e, 'ready', today, month))
  const week = entries.filter((e) => maintenanceMatchesPeriod(e, 'week', today, month))
  const repairs = allEntries.filter(
    (e) =>
      e.kind === 'work_order' &&
      (!q ||
        [e.itemName, e.assetTag, e.title, e.detail, e.status?.replaceAll('_', ' ')].some((value) =>
          value?.toLowerCase().includes(q),
        )),
  )
  const workOrdersByItem = new Map<string, number>()
  for (const r of data.workOrderRows)
    workOrdersByItem.set(r.itemId, (workOrdersByItem.get(r.itemId) ?? 0) + 1)
  const workEntries = entries.filter((e) => maintenanceMatchesPeriod(e, period, today, month))
  const workTotal = workEntries.length
  const page = clamp(
    Number(pickString(sp.page) ?? '1'),
    1,
    Math.max(1, Math.ceil(workTotal / PER_PAGE)),
  )
  const pageEntries = workEntries.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const byDay = new Map<string, Entry[]>()
  for (const e of entries) {
    if (e.dueOn && e.dueOn >= monthStart && e.dueOn <= monthEnd) {
      const list = byDay.get(e.dueOn) ?? []
      list.push(e)
      byDay.set(e.dueOn, list)
    }
  }
  const dayEntries = drawerDay ? (byDay.get(drawerDay) ?? []) : []
  const dayPage = clamp(
    Number(pickString(sp.dayPage) ?? '1'),
    1,
    Math.max(1, Math.ceil(dayEntries.length / PER_PAGE)),
  )
  const daysInMonth = monthEndDate.getUTCDate()
  const leadingBlanks = monthStartDate.getUTCDay()
  const weeks = Math.ceil((leadingBlanks + daysInMonth) / 7)
  const trailingBlanks = weeks * 7 - leadingBlanks - daysInMonth
  const monthLabel = monthStartDate.toLocaleDateString(ctx.locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const editingRow = data.reminderRows.find((r) => drawerKey === `reminder-${r.reminder.id}`)
  const reminderEditing: ReminderEditing | null = editingRow
    ? {
        id: editingRow.reminder.id,
        equipmentItemId: editingRow.itemId,
        title: editingRow.reminder.title,
        details: editingRow.reminder.details,
        dueOn: editingRow.reminder.dueOn,
        repeatIntervalValue: editingRow.reminder.repeatIntervalValue,
        repeatIntervalUnit: editingRow.reminder.repeatIntervalUnit,
        assignedToPersonId: editingRow.reminder.assignedToPersonId,
        equipmentItemOption: {
          value: editingRow.itemId,
          label: `${editingRow.itemName} (${editingRow.assetTag})`,
        },
        assignedToOption: editingRow.assignee
          ? {
              value: editingRow.assignee.id,
              label: `${editingRow.assignee.lastName}, ${editingRow.assignee.firstName}`,
            }
          : undefined,
      }
    : null
  const listProps = {
    today,
    manage,
    inspect,
    createWorkOrder,
    sp,
    workOrdersByItem,
    timeZone: ctx.timezone,
    locale: ctx.locale,
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGeneratedValue('Equipment maintenance')}
            description={tGeneratedValue(
              'Plan the shop work. Inspect equipment, finish service tasks, and keep repairs moving.',
            )}
            actions={
              <div className="flex flex-wrap gap-2">
                <Link href="/equipment/maintenance/inspection-status">
                  <Button variant="outline">
                    <GeneratedValue value="Inspection status" />
                  </Button>
                </Link>
                {manage ? (
                  <Link href="/equipment/maintenance/settings">
                    <Button variant="outline">
                      <GeneratedValue value="Reminder settings" />
                    </Button>
                  </Link>
                ) : null}
                {createWorkOrder ? (
                  <Link href="/equipment/work-orders/new">
                    <Button variant="outline">
                      <Wrench size={14} />
                      <GeneratedValue value="New work order" />
                    </Button>
                  </Link>
                ) : null}
                {manage ? (
                  <Link
                    href={mergeHref(BASE, sp, { drawer: 'reminder-new' }) as never}
                    scroll={false}
                  >
                    <Button>
                      <Plus size={14} />
                      <GeneratedValue value="New reminder" />
                    </Button>
                  </Link>
                ) : null}
              </div>
            }
          />
          <EquipmentSubNav active="maintenance" />
          <TableToolbar>
            <SearchInput
              placeholder={tGeneratedValue('Search equipment, task, work order or mechanic…')}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="kind"
              label={tGeneratedValue('Task')}
              options={Object.entries(KIND_META).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="cat"
              label={tGeneratedValue('Category')}
              options={data.categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </TableToolbar>
        </>
      }
      className="space-y-4"
    >
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-walkthrough="maintenance-priorities"
      >
        <StatTile
          icon={AlarmClock}
          tone="rose"
          label={tGeneratedValue('Overdue')}
          value={overdue.length}
          dense
          href={mergeHref(BASE, sp, { due: 'overdue', page: undefined, view: 'list' })}
        />
        <StatTile
          icon={ClipboardCheck}
          tone="amber"
          label={tGeneratedValue('Ready to do')}
          value={dueToday.length}
          dense
          href={mergeHref(BASE, sp, { due: 'ready', page: undefined, view: 'list' })}
        />
        <StatTile
          icon={CalendarDays}
          tone="sky"
          label={tGeneratedValue('Next 7 days')}
          value={week.length}
          dense
          href={mergeHref(BASE, sp, { due: 'week', page: undefined, view: 'list' })}
        />
        <StatTile
          icon={Wrench}
          tone="violet"
          label={tGeneratedValue('Outstanding repairs')}
          value={repairs.length}
          dense
          href={mergeHref(BASE, sp, {
            kind: 'work_order',
            due: undefined,
            page: undefined,
            view: 'list',
          })}
        />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedValue value="Scheduled inspections and service belong here. Pre-use checks stay with the operator. Work orders show repair status; they do not have a scheduled due date." />
      </p>
      <div className="lg:hidden">
        <TabNav
          basePath={BASE}
          currentParams={sp}
          paramKey="view"
          active={view}
          variant="pills"
          tabs={[
            { key: 'list', label: 'Work list' },
            { key: 'calendar', label: 'Calendar' },
          ]}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          className={view === 'calendar' ? 'hidden lg:block' : ''}
          data-walkthrough="maintenance-work-list"
        >
          <CardHeader className="space-y-3 pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>
                <GeneratedValue value="Work list" />{' '}
                <span className="text-sm font-normal text-slate-500">({workTotal})</span>
              </CardTitle>
              {period ? (
                <Link
                  className="text-xs text-teal-700 hover:underline dark:text-teal-300"
                  href={mergeHref(BASE, sp, { due: undefined, page: undefined }) as never}
                >
                  <GeneratedValue value="Show all dates" />
                </Link>
              ) : null}
            </div>
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="due"
              label={tGeneratedValue('Due')}
              options={[
                { value: 'overdue', label: 'Overdue' },
                { value: 'ready', label: 'Ready to do' },
                { value: 'today', label: 'Due today' },
                { value: 'week', label: 'Next 7 days' },
                { value: 'month', label: 'Calendar month' },
                { value: 'undated', label: 'Needs setup' },
              ]}
            />
          </CardHeader>
          <CardContent className="pt-0">
            {pageEntries.length ? (
              <WorkList entries={pageEntries} {...listProps} />
            ) : (
              <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                <ClipboardCheck className="mx-auto mb-3" size={28} />
                <GeneratedValue value="No tasks match these filters. Change the filters to see other equipment work." />
              </div>
            )}
            <Pagination
              basePath={BASE}
              currentParams={sp}
              total={workTotal}
              page={page}
              perPage={PER_PAGE}
            />
          </CardContent>
        </Card>
        <div
          className={view === 'list' ? 'hidden lg:block lg:self-stretch' : 'lg:self-stretch'}
          data-walkthrough="maintenance-calendar"
        >
          {/* Month calendar — navigate months to plan ahead. */}
          <Card className="flex h-[540px] flex-col lg:sticky lg:top-0 lg:h-[620px]">
            <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-3 space-y-0 pb-3">
              <CardTitle>
                <GeneratedValue value={monthLabel} />
              </CardTitle>
              <div className="flex items-center gap-1">
                <Link
                  href={mergeHref(BASE, sp, { month: prevMonth }) as never}
                  className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                  aria-label={tGenerated('m_17404e648473bd')}
                >
                  <ChevronLeft size={14} />
                </Link>
                <GeneratedValue
                  value={
                    month !== currentMonth ? (
                      <Link
                        href={mergeHref(BASE, sp, { month: undefined }) as never}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                      >
                        <GeneratedText id="m_1fca2ff1421477" />
                      </Link>
                    ) : null
                  }
                />
                <Link
                  href={mergeHref(BASE, sp, { month: nextMonth }) as never}
                  className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                  aria-label={tGenerated('m_17ae862fdd8d6e')}
                >
                  <ChevronRight size={14} />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
              <div
                className="grid min-h-0 flex-1 grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs dark:border-slate-800 dark:bg-slate-800"
                style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(0, 1fr))` }}
              >
                <GeneratedValue
                  value={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div
                      key={d}
                      className="bg-slate-50 px-2 py-1.5 text-center font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400"
                    >
                      <GeneratedValue value={d} />
                    </div>
                  ))}
                />
                <GeneratedValue
                  value={Array.from({ length: leadingBlanks }, (_, i) => (
                    <div key={`lead-${i}`} className="bg-white dark:bg-slate-900" />
                  ))}
                />
                <GeneratedValue
                  value={Array.from({ length: daysInMonth }, (_, i) => {
                    const day = `${month}-${String(i + 1).padStart(2, '0')}`
                    const dayEntries = byDay.get(day) ?? []
                    const isToday = day === today
                    return (
                      <div
                        key={day}
                        className={`min-h-0 space-y-1 overflow-hidden bg-white p-1.5 dark:bg-slate-900 ${
                          isToday ? 'ring-2 ring-teal-500 ring-inset' : ''
                        }`}
                      >
                        <div
                          className={`text-right text-[11px] ${
                            isToday
                              ? 'font-semibold text-teal-600 dark:text-teal-400'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          <GeneratedValue value={i + 1} />
                        </div>
                        {dayEntries.length > 0 ? (
                          <Link
                            href={
                              mergeHref(BASE, sp, {
                                drawer: `day-${day}`,
                                dayPage: undefined,
                              }) as never
                            }
                            scroll={false}
                            aria-label={`${day}: ${dayEntries.length} ${tGenerated('m_0fed2a204aff5a')}`}
                            title={dayEntries.map((e) => `${e.assetTag} · ${e.title}`).join('\n')}
                            className={`flex items-center justify-center gap-1 rounded px-1 py-1 font-semibold ${
                              dayEntries.some((e) =>
                                maintenanceMatchesPeriod(e, 'overdue', today, month),
                              )
                                ? 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60'
                                : 'bg-teal-100 text-teal-800 hover:bg-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:hover:bg-teal-900/60'
                            }`}
                          >
                            {dayEntries.length} <GeneratedText id="m_0fed2a204aff5a" />
                          </Link>
                        ) : null}
                      </div>
                    )
                  })}
                />
                <GeneratedValue
                  value={Array.from({ length: trailingBlanks }, (_, i) => (
                    <div key={`trail-${i}`} className="bg-white dark:bg-slate-900" />
                  ))}
                />
              </div>
              <div className="mt-2 flex shrink-0 flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue
                  value={(Object.keys(KIND_META) as EntryKind[])
                    .filter((k) => k !== 'work_order')
                    .map((k) => (
                      <span key={k} className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${KIND_META[k].dot}`} />
                        <GeneratedValue value={KIND_META[k].label} />
                      </span>
                    ))}
                />
              </div>
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value="The calendar shows dated tasks for the selected month. Use the work list for undated tasks and repairs." />
          </p>
        </div>
      </div>
      <UrlDrawer
        open={drawerDay !== null}
        closeHref={closeHref}
        title={drawerDay ? formatDate(new Date(`${drawerDay}T12:00:00Z`), 'UTC', ctx.locale) : ''}
        size="lg"
      >
        <WorkList
          entries={dayEntries.slice((dayPage - 1) * PER_PAGE, dayPage * PER_PAGE)}
          {...listProps}
        />
        <Pagination
          basePath={BASE}
          currentParams={sp}
          total={dayEntries.length}
          page={dayPage}
          perPage={PER_PAGE}
          pageParamKey="dayPage"
        />
      </UrlDrawer>
      <EquipmentInspectionDrawer
        open={drawerKey === 'inspection'}
        closeHref={closeHref}
        inspectionId={pickString(sp.inspectionId) ?? null}
        sp={sp}
        returnTo={closeHref}
      />
      <ReminderDrawer
        defaultDate={today}
        open={manage && (drawerKey === 'reminder-new' || reminderEditing !== null)}
        closeHref={closeHref}
        itemLookup="equipment-reminder-items"
        editing={reminderEditing}
        peopleLookup="equipment-reminder-assignees"
      />
    </ListPageLayout>
  )
}

function WorkList({
  entries,
  today,
  manage,
  inspect,
  createWorkOrder,
  sp,
  workOrdersByItem,
  timeZone,
  locale,
}: {
  entries: Entry[]
  today: string
  manage: boolean
  inspect: boolean
  createWorkOrder: boolean
  sp: Record<string, string | string[] | undefined>
  workOrdersByItem: Map<string, number>
  timeZone: string
  locale: AppLocale
}) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {entries.map((e) => {
        const repairCount = workOrdersByItem.get(e.itemId) ?? 0
        const overdue = e.serviceStatus
          ? e.serviceStatus === 'overdue'
          : e.dueOn !== null && e.dueOn < today
        return (
          <li key={e.key} className="space-y-2.5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={
                    e.workOrderId
                      ? `/equipment/work-orders/${e.workOrderId}`
                      : `/equipment/${e.itemId}?tab=inspections`
                  }
                  className="text-xs break-words text-teal-700 hover:underline dark:text-teal-300"
                >
                  {e.assetTag} · {e.itemName}
                </Link>
                <p className="mt-1 text-sm font-semibold break-words text-slate-900 dark:text-slate-100">
                  {e.title}
                </p>
              </div>
              <Badge
                variant={overdue || e.priority === 'high' ? 'destructive' : 'secondary'}
                className="shrink-0"
              >
                <GeneratedValue value={KIND_META[e.kind].label} />
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {e.kind === 'work_order' ? (
                <>
                  <Badge variant={e.status === 'awaiting_parts' ? 'warning' : 'secondary'}>
                    <GeneratedValue value={e.status?.replaceAll('_', ' ')} />
                  </Badge>
                  <Badge variant={e.priority === 'high' ? 'destructive' : 'secondary'}>
                    <GeneratedValue
                      value={
                        e.priority === 'med' ? 'Medium' : e.priority === 'high' ? 'High' : 'Low'
                      }
                    />
                  </Badge>
                  <span>
                    <GeneratedValue value="Opened" />{' '}
                    {e.openedOn ? formatDate(new Date(e.openedOn), timeZone, locale) : '—'}
                  </span>
                </>
              ) : (
                <span className={overdue ? 'font-medium text-rose-600 dark:text-rose-400' : ''}>
                  <GeneratedValue
                    value={
                      e.serviceStatus
                        ? {
                            paused: 'Paused',
                            needs_setup: 'Needs setup',
                            upcoming: 'Upcoming',
                            due: 'Ready to do',
                            overdue: 'Overdue',
                          }[e.serviceStatus]
                        : overdue
                          ? 'Overdue'
                          : e.dueOn === today
                            ? 'Due today'
                            : e.dueOn
                              ? 'Due'
                              : 'Needs a date'
                    }
                  />{' '}
                  {e.dueOn && !e.serviceStatus && e.dueOn !== today ? e.dueOn : ''}
                </span>
              )}
              {e.detail ? <span className="line-clamp-2 break-words">{e.detail}</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {inspect && e.startTypeId ? (
                <StartInspectionButton
                  itemId={e.itemId}
                  typeId={e.startTypeId}
                  returnTo={mergeHref(BASE, sp, { drawer: undefined, dayPage: undefined })}
                  tone="button"
                />
              ) : null}
              {manage && e.scheduleId && !e.startTypeId ? (
                <CompleteSchedule id={e.scheduleId} />
              ) : null}
              {e.kind === 'service' ? (
                <Link
                  href={`/equipment/${e.itemId}?tab=inspections&itab=maintenance${manage ? `&drawer=${e.serviceStatus === 'needs_setup' ? 'service-edit' : 'service-complete'}&serviceId=${e.servicePlanId}` : ''}`}
                >
                  <Button size="sm" variant="outline">
                    <Settings2 size={14} />
                    <GeneratedValue
                      value={
                        manage
                          ? e.serviceStatus === 'needs_setup'
                            ? 'Set up maintenance'
                            : 'Record completed'
                          : 'View maintenance'
                      }
                    />
                  </Button>
                </Link>
              ) : null}
              {manage && e.reminderId ? (
                <>
                  <form action={completeEquipmentReminder}>
                    <input type="hidden" name="id" value={e.reminderId} />
                    <Button size="sm" variant="outline" type="submit">
                      <Check size={14} />
                      <GeneratedValue value="Done" />
                    </Button>
                  </form>
                  <Link
                    href={
                      mergeHref(BASE, sp, {
                        drawer: `reminder-${e.reminderId}`,
                        dayPage: undefined,
                      }) as never
                    }
                    scroll={false}
                    className="text-xs text-teal-700 hover:underline dark:text-teal-300"
                  >
                    <GeneratedValue value="Edit reminder" />
                  </Link>
                </>
              ) : null}
              {e.workOrderId ? (
                <Link href={`/equipment/work-orders/${e.workOrderId}`}>
                  <Button size="sm" variant="outline">
                    <Wrench size={14} />
                    <GeneratedValue value="Open work order" />
                  </Button>
                </Link>
              ) : null}
              {e.kind !== 'work_order' && repairCount > 0 ? (
                <Link
                  href={`/equipment/${e.itemId}?tab=work_orders`}
                  className="text-xs text-teal-700 hover:underline dark:text-teal-300"
                >
                  <GeneratedValue value="Outstanding repairs" /> ({repairCount})
                </Link>
              ) : null}
              {e.kind !== 'work_order' && createWorkOrder ? (
                <Link
                  href={`/equipment/work-orders/new?itemId=${e.itemId}`}
                  className="text-xs text-teal-700 hover:underline dark:text-teal-300"
                >
                  <GeneratedValue value="New work order" />
                </Link>
              ) : null}
              {e.kind === 'warranty' || (!e.dueOn && e.kind === 'inspection') ? (
                <Link
                  href={`/equipment/${e.itemId}?tab=inspections`}
                  className="text-xs text-teal-700 hover:underline dark:text-teal-300"
                >
                  <GeneratedValue value="Equipment details" />
                </Link>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
