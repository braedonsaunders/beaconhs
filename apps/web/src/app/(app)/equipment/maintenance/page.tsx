import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
// Equipment maintenance cockpit — the fleet-wide "what should a technician be
// doing, to which unit, when" view. One merged agenda from three sources:
// per-unit inspection schedules, ad-hoc reminders, and oil-change tracking.
// Overdue/today/this-week tiles up top, a month calendar in the middle
// (desktop), and a day-grouped work list that is the primary mobile surface.

import Link from 'next/link'
import { and, asc, count, desc, eq, isNull, lte, notInArray, sql, type SQL } from 'drizzle-orm'
import {
  AlarmClock,
  BellRing,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Droplets,
  Plus,
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
  equipmentInspectionRecords,
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentReminders,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import type { AppLocale } from '@beaconhs/i18n'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { clamp, isUuid, mergeHref, pickString } from '@/lib/list-params'
import { formatDate } from '@/lib/datetime'
import { formatInterval } from '@/lib/equipment/intervals'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { TableToolbar } from '@/components/table-toolbar'
import { FilterChips } from '@/components/filter-bar'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { StatTile } from '@/components/stat-tile'
import { completeEquipmentReminder } from '../_maintenance-actions'
import { ReminderDrawer, type ReminderEditing } from '../_maintenance-drawers'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0e6750f1a6b581') }
}
export const dynamic = 'force-dynamic'

const BASE = '/equipment/maintenance'
const PER_PAGE = 15

type EntryKind = 'inspection' | 'reminder' | 'oil_change'

type Entry = {
  key: string
  kind: EntryKind
  itemId: string
  itemName: string
  assetTag: string
  title: string
  detail: string | null
  dueOn: string
  /** Link to start the work (fill the inspection) when one exists. */
  startHref: string | null
  reminderId: string | null
}

const KIND_META: Record<EntryKind, { label: string; dot: string }> = {
  inspection: { label: 'Inspection', dot: 'bg-teal-500' },
  reminder: { label: 'Reminder', dot: 'bg-amber-500' },
  oil_change: { label: 'Oil change', dot: 'bg-violet-500' },
}

type UnitDrawerData = {
  item: typeof equipmentItems.$inferSelect
  typeName: string | null
  categoryName: string | null
  siteName: string | null
  holderName: string | null
  schedules: {
    id: string
    typeName: string | null
    label: string | null
    inspectionTypeId: string | null
    intervalValue: number
    intervalUnit: 'day' | 'week' | 'month' | 'year'
    lastCompletedOn: string | null
    nextDueOn: string
    isActive: boolean
  }[]
  reminders: {
    id: string
    title: string
    dueOn: string
    assignee: string | null
    repeat: string | null
  }[]
  remindersTotal: number
  inspections: {
    id: string
    reference: string
    occurredAt: Date
    result: string | null
    status: string
  }[]
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return isoDate(d)
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
  const manage = can(ctx, 'equipment.manage')

  const today = isoDate(new Date())
  const currentMonth = today.slice(0, 7)
  const rawMonth = pickString(sp.month)
  const month = rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : currentMonth
  const monthStart = `${month}-01`
  const monthStartDate = new Date(`${monthStart}T00:00:00Z`)
  const monthEndDate = new Date(monthStartDate)
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1)
  monthEndDate.setUTCDate(0) // last day of the viewed month
  const monthEnd = isoDate(monthEndDate)
  const prevMonth = isoDate(
    new Date(Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() - 1, 1)),
  ).slice(0, 7)
  const nextMonth = isoDate(
    new Date(Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() + 1, 1)),
  ).slice(0, 7)
  // Fetch far enough out that the summary tiles stay correct even when the
  // viewer is looking at a past month.
  const horizon = monthEnd > addDays(today, 60) ? monthEnd : addDays(today, 60)

  const kindFilter = pickString(sp.kind)
  const catFilter = pickString(sp.cat)
  const q = pickString(sp.q)?.trim().toLowerCase() || undefined
  const page = clamp(Number(pickString(sp.page) ?? '1'), 1, 10_000)
  const drawerKey = pickString(sp.drawer)
  const drawerUnitRaw = drawerKey?.startsWith('unit-') ? drawerKey.slice('unit-'.length) : null
  const drawerUnitId = drawerUnitRaw && isUuid(drawerUnitRaw) ? drawerUnitRaw : null
  const drawerDayRaw = drawerKey?.startsWith('day-') ? drawerKey.slice('day-'.length) : null
  const drawerDay = drawerDayRaw && /^\d{4}-\d{2}-\d{2}$/.test(drawerDayRaw) ? drawerDayRaw : null

  const data = await ctx.db(async (tx) => {
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const itemFilters: (SQL | undefined)[] = [
      isNull(equipmentItems.deletedAt),
      notInArray(equipmentItems.status, ['retired', 'lost']),
      vis,
      catFilter ? eq(equipmentItems.categoryId, catFilter) : undefined,
    ]

    const [scheduleRows, reminderRows, oilRows, categories] = await Promise.all([
      tx
        .select({
          schedule: equipmentInspectionSchedules,
          typeName: equipmentInspectionTypes.name,
          itemId: equipmentItems.id,
          itemName: equipmentItems.name,
          assetTag: equipmentItems.assetTag,
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
            lte(equipmentInspectionSchedules.nextDueOn, horizon),
            ...itemFilters,
          ),
        )
        .orderBy(asc(equipmentInspectionSchedules.nextDueOn)),
      tx
        .select({
          reminder: equipmentReminders,
          assignee: people,
          itemId: equipmentItems.id,
          itemName: equipmentItems.name,
          assetTag: equipmentItems.assetTag,
        })
        .from(equipmentReminders)
        .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentReminders.equipmentItemId))
        .leftJoin(people, eq(people.id, equipmentReminders.assignedToPersonId))
        .where(
          and(
            isNull(equipmentReminders.completedAt),
            lte(equipmentReminders.dueOn, horizon),
            ...itemFilters,
          ),
        )
        .orderBy(asc(equipmentReminders.dueOn)),
      tx
        .select({
          itemId: equipmentItems.id,
          itemName: equipmentItems.name,
          assetTag: equipmentItems.assetTag,
          dueOn: equipmentItems.nextOilChangeDue,
          intervalMonths: equipmentItems.oilChangeIntervalMonths,
        })
        .from(equipmentItems)
        .where(
          and(
            eq(equipmentItems.requiresOilChange, true),
            sql`${equipmentItems.nextOilChangeDue} IS NOT NULL`,
            lte(equipmentItems.nextOilChangeDue, horizon),
            ...itemFilters,
          ),
        )
        .orderBy(asc(equipmentItems.nextOilChangeDue)),
      tx
        .select({ id: equipmentCategories.id, name: equipmentCategories.name })
        .from(equipmentCategories)
        .orderBy(asc(equipmentCategories.sortOrder), asc(equipmentCategories.name)),
    ])

    // Quick-detail flyout: the clicked unit's whole maintenance picture. Same
    // visibility scope as the list; an out-of-scope id simply renders nothing.
    let unit: UnitDrawerData | null = null
    if (drawerUnitId) {
      const [row] = await tx
        .select({
          item: equipmentItems,
          typeName: equipmentTypes.name,
          categoryName: equipmentCategories.name,
          siteName: orgUnits.name,
          holderFirst: people.firstName,
          holderLast: people.lastName,
        })
        .from(equipmentItems)
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
        .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
        .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
        .where(and(eq(equipmentItems.id, drawerUnitId), isNull(equipmentItems.deletedAt), vis))
        .limit(1)
      if (row) {
        const [unitSchedules, unitReminders, unitRemindersTotal, unitInspections] =
          await Promise.all([
            tx
              .select({
                id: equipmentInspectionSchedules.id,
                typeName: equipmentInspectionTypes.name,
                label: equipmentInspectionSchedules.label,
                inspectionTypeId: equipmentInspectionSchedules.inspectionTypeId,
                intervalValue: equipmentInspectionSchedules.intervalValue,
                intervalUnit: equipmentInspectionSchedules.intervalUnit,
                lastCompletedOn: equipmentInspectionSchedules.lastCompletedOn,
                nextDueOn: equipmentInspectionSchedules.nextDueOn,
                isActive: equipmentInspectionSchedules.isActive,
              })
              .from(equipmentInspectionSchedules)
              .leftJoin(
                equipmentInspectionTypes,
                eq(equipmentInspectionTypes.id, equipmentInspectionSchedules.inspectionTypeId),
              )
              .where(eq(equipmentInspectionSchedules.equipmentItemId, drawerUnitId))
              .orderBy(asc(equipmentInspectionSchedules.nextDueOn)),
            tx
              .select({ reminder: equipmentReminders, assignee: people })
              .from(equipmentReminders)
              .leftJoin(people, eq(people.id, equipmentReminders.assignedToPersonId))
              .where(
                and(
                  eq(equipmentReminders.equipmentItemId, drawerUnitId),
                  isNull(equipmentReminders.completedAt),
                ),
              )
              .orderBy(asc(equipmentReminders.dueOn))
              .limit(25),
            tx
              .select({ c: count() })
              .from(equipmentReminders)
              .where(
                and(
                  eq(equipmentReminders.equipmentItemId, drawerUnitId),
                  isNull(equipmentReminders.completedAt),
                ),
              )
              .then((rows) => Number(rows[0]?.c ?? 0)),
            tx
              .select({
                id: equipmentInspectionRecords.id,
                reference: equipmentInspectionRecords.reference,
                occurredAt: equipmentInspectionRecords.occurredAt,
                result: equipmentInspectionRecords.result,
                status: equipmentInspectionRecords.status,
              })
              .from(equipmentInspectionRecords)
              .where(
                and(
                  eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
                  eq(equipmentInspectionRecords.equipmentItemId, drawerUnitId),
                  isNull(equipmentInspectionRecords.deletedAt),
                ),
              )
              .orderBy(desc(equipmentInspectionRecords.occurredAt))
              .limit(5),
          ])
        unit = {
          item: row.item,
          typeName: row.typeName,
          categoryName: row.categoryName,
          siteName: row.siteName,
          holderName: row.holderLast ? `${row.holderFirst} ${row.holderLast}` : null,
          schedules: unitSchedules,
          reminders: unitReminders.map((r) => ({
            id: r.reminder.id,
            title: r.reminder.title,
            dueOn: r.reminder.dueOn,
            assignee: r.assignee ? `${r.assignee.firstName} ${r.assignee.lastName}` : null,
            repeat:
              r.reminder.repeatIntervalValue && r.reminder.repeatIntervalUnit
                ? formatInterval(r.reminder.repeatIntervalValue, r.reminder.repeatIntervalUnit)
                : null,
          })),
          remindersTotal: unitRemindersTotal,
          inspections: unitInspections,
        }
      }
    }
    return { scheduleRows, reminderRows, oilRows, categories, unit }
  })

  // ---- Merge the three sources into one agenda -------------------------------
  const entries: Entry[] = [
    ...data.scheduleRows.map((r) => ({
      key: `s-${r.schedule.id}`,
      kind: 'inspection' as const,
      itemId: r.itemId,
      itemName: r.itemName,
      assetTag: r.assetTag,
      title: r.typeName ?? r.schedule.label ?? 'Inspection',
      detail: formatInterval(r.schedule.intervalValue, r.schedule.intervalUnit),
      dueOn: r.schedule.nextDueOn,
      startHref: r.schedule.inspectionTypeId
        ? `/equipment/inspections/new?itemId=${r.itemId}&typeId=${r.schedule.inspectionTypeId}`
        : null,
      reminderId: null,
    })),
    ...data.reminderRows.map((r) => ({
      key: `r-${r.reminder.id}`,
      kind: 'reminder' as const,
      itemId: r.itemId,
      itemName: r.itemName,
      assetTag: r.assetTag,
      title: r.reminder.title,
      detail: [
        r.assignee ? `${r.assignee.firstName} ${r.assignee.lastName}` : null,
        r.reminder.repeatIntervalValue && r.reminder.repeatIntervalUnit
          ? formatInterval(r.reminder.repeatIntervalValue, r.reminder.repeatIntervalUnit)
          : null,
        r.reminder.details,
      ]
        .filter(Boolean)
        .join(' · '),
      dueOn: r.reminder.dueOn,
      startHref: null,
      reminderId: r.reminder.id,
    })),
    ...data.oilRows.map((r) => ({
      key: `o-${r.itemId}`,
      kind: 'oil_change' as const,
      itemId: r.itemId,
      itemName: r.itemName,
      assetTag: r.assetTag,
      title: 'Oil change',
      detail: r.intervalMonths ? formatInterval(r.intervalMonths, 'month') : null,
      dueOn: r.dueOn!,
      startHref: null,
      reminderId: null,
    })),
  ]
    .filter((e) => !kindFilter || e.kind === kindFilter)
    .filter(
      (e) =>
        !q ||
        e.itemName.toLowerCase().includes(q) ||
        e.assetTag.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q),
    )
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0))

  const overdue = entries.filter((e) => e.dueOn < today)
  const dueToday = entries.filter((e) => e.dueOn === today)
  const week = entries.filter((e) => e.dueOn > today && e.dueOn <= addDays(today, 7))
  const next30 = entries.filter((e) => e.dueOn >= today && e.dueOn <= addDays(today, 30))

  // Calendar cells for the viewed month (Sunday-first grid).
  const byDay = new Map<string, Entry[]>()
  for (const e of entries) {
    if (e.dueOn >= monthStart && e.dueOn <= monthEnd) {
      const list = byDay.get(e.dueOn) ?? []
      list.push(e)
      byDay.set(e.dueOn, list)
    }
  }
  const daysInMonth = monthEndDate.getUTCDate()
  const leadingBlanks = monthStartDate.getUTCDay()
  const weeks = Math.ceil((leadingBlanks + daysInMonth) / 7)
  const trailingBlanks = weeks * 7 - leadingBlanks - daysInMonth
  const monthLabel = monthStartDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  // Work list: one flat, paginated agenda (overdue first via the asc sort).
  const workTotal = entries.length
  const pageEntries = entries.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const editingReminderRow =
    drawerKey?.startsWith('reminder-') && drawerKey !== 'reminder-new'
      ? (data.reminderRows.find((r) => `reminder-${r.reminder.id}` === drawerKey) ?? null)
      : null
  const reminderEditing: ReminderEditing | null = editingReminderRow
    ? {
        id: editingReminderRow.reminder.id,
        equipmentItemId: editingReminderRow.itemId,
        title: editingReminderRow.reminder.title,
        details: editingReminderRow.reminder.details,
        dueOn: editingReminderRow.reminder.dueOn,
        repeatIntervalValue: editingReminderRow.reminder.repeatIntervalValue,
        repeatIntervalUnit: editingReminderRow.reminder.repeatIntervalUnit,
        assignedToPersonId: editingReminderRow.reminder.assignedToPersonId,
        equipmentItemOption: {
          value: editingReminderRow.itemId,
          label: `${editingReminderRow.itemName} (${editingReminderRow.assetTag})`,
        },
        assignedToOption: editingReminderRow.assignee
          ? {
              value: editingReminderRow.assignee.id,
              label: `${editingReminderRow.assignee.lastName}, ${editingReminderRow.assignee.firstName}`,
              hint: editingReminderRow.assignee.employeeNo ?? undefined,
            }
          : undefined,
      }
    : null

  const closeHref = mergeHref(BASE, sp, { drawer: undefined })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_08fc3f5f377c0d')}
            description={tGenerated('m_17a93656a9e4d7')}
            actions={
              manage ? (
                <Link
                  href={mergeHref(BASE, sp, { drawer: 'reminder-new' }) as never}
                  scroll={false}
                >
                  <Button>
                    <Plus size={14} /> <GeneratedText id="m_04b0444a0259a5" />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <EquipmentSubNav active="maintenance" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0f08106564c851')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="kind"
              label={tGenerated('m_1e578efe1574cd')}
              options={[
                { value: 'inspection', label: 'Inspections' },
                { value: 'reminder', label: 'Reminders' },
                { value: 'oil_change', label: 'Oil changes' },
              ]}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="cat"
              label={tGenerated('m_108b41637f364f')}
              options={data.categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </TableToolbar>
        </>
      }
      className="flex h-full min-h-0 flex-col gap-4"
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={AlarmClock}
            tone="rose"
            label={tGenerated('m_1e40bdcf2d1ba1')}
            value={overdue.length}
            dense
          />
          <StatTile
            icon={ClipboardCheck}
            tone="amber"
            label={tGenerated('m_16bc9720eed909')}
            value={dueToday.length}
            dense
          />
          <StatTile
            icon={CalendarClock}
            tone="sky"
            label={tGenerated('m_0aa89e9cafb163')}
            value={week.length}
            dense
          />
          <StatTile
            icon={CalendarDays}
            tone="teal"
            label={tGenerated('m_13c6af1fdd2945')}
            value={next30.length}
            dense
          />
        </div>

        {/* 1/3 work list + 2/3 calendar, filling the viewport — the page never
            scrolls; only the work list's rows scroll. The calendar is
            desktop-only — the paginated list is the mobile surface. */}
        <div className="flex min-h-0 flex-1 gap-4">
          <Card className="flex h-full min-h-0 w-full flex-col lg:w-1/3">
            <CardHeader className="shrink-0 pb-3">
              <CardTitle>
                <GeneratedText id="m_0e45cb7349c90b" />
                <GeneratedValue value={workTotal} />)
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pt-0">
              <div className="app-scroll min-h-0 flex-1 overflow-y-auto pr-1">
                <GeneratedValue
                  value={
                    pageEntries.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        <GeneratedValue
                          value={
                            q || kindFilter || catFilter ? (
                              <GeneratedText id="m_18f1fb1d9679b3" />
                            ) : (
                              <GeneratedText id="m_0d1a41bfdf1526" />
                            )
                          }
                        />
                      </p>
                    ) : (
                      <WorkList entries={pageEntries} today={today} manage={manage} sp={sp} />
                    )
                  }
                />
              </div>
              <div className="shrink-0 border-t border-slate-100 dark:border-slate-800">
                <Pagination
                  basePath={BASE}
                  currentParams={sp}
                  total={workTotal}
                  page={page}
                  perPage={PER_PAGE}
                />
              </div>
            </CardContent>
          </Card>

          {/* Month calendar — navigate months to plan ahead. */}
          <Card className="hidden h-full min-h-0 flex-1 lg:flex lg:flex-col">
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
                        <GeneratedValue
                          value={(dayEntries.length > 2 ? [] : dayEntries).map((e) => (
                            <Link
                              key={e.key}
                              href={mergeHref(BASE, sp, { drawer: `unit-${e.itemId}` }) as never}
                              scroll={false}
                              title={tGeneratedValue(`${e.itemName} — ${e.title}`)}
                              className={`flex items-center gap-1 truncate rounded px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 ${
                                e.dueOn < today
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${KIND_META[e.kind].dot}`}
                              />
                              <span className="truncate">
                                <GeneratedValue value={e.assetTag} /> ·{' '}
                                <GeneratedValue value={e.title} />
                              </span>
                            </Link>
                          ))}
                        />
                        <GeneratedValue
                          value={
                            dayEntries.length > 2 ? (
                              // Busy day → one grouped alert instead of clipped chips;
                              // opens the day flyout with the full list.
                              <Link
                                href={mergeHref(BASE, sp, { drawer: `day-${day}` }) as never}
                                scroll={false}
                                className={`flex items-center justify-center gap-1 rounded px-1 py-1 font-semibold ${
                                  dayEntries.some((e) => e.dueOn < today)
                                    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60'
                                    : 'bg-teal-100 text-teal-800 hover:bg-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:hover:bg-teal-900/60'
                                }`}
                              >
                                <GeneratedValue value={dayEntries.length} />{' '}
                                <GeneratedText id="m_0fed2a204aff5a" />
                              </Link>
                            ) : null
                          }
                        />
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
                  value={(Object.keys(KIND_META) as EntryKind[]).map((k) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${KIND_META[k].dot}`} />
                      <GeneratedValue value={KIND_META[k].label} />
                      <GeneratedText id="m_00ded356f0f424" />
                    </span>
                  ))}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Everything due on one day — rows click through to the unit flyout. */}
      <UrlDrawer
        open={drawerDay != null}
        closeHref={closeHref}
        title={tGeneratedValue(
          drawerDay
            ? new Date(`${drawerDay}T00:00:00Z`).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              })
            : '',
        )}
        description={tGenerated('m_05fded0c6c6e5b', {
          value0: drawerDay ? (byDay.get(drawerDay)?.length ?? 0) : 0,
        })}
        size="md"
      >
        <GeneratedValue
          value={
            drawerDay && (byDay.get(drawerDay)?.length ?? 0) > 0 ? (
              <WorkList entries={byDay.get(drawerDay)!} today={today} manage={manage} sp={sp} />
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_139a2683df869b" />
              </p>
            )
          }
        />
      </UrlDrawer>

      <UnitMaintenanceDrawer
        open={drawerKey?.startsWith('unit-') ?? false}
        closeHref={closeHref}
        unit={data.unit}
        today={today}
        manage={manage}
        timeZone={ctx.timezone}
        locale={ctx.locale}
      />

      <ReminderDrawer
        open={manage && (drawerKey === 'reminder-new' || reminderEditing != null)}
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
  sp,
}: {
  entries: Entry[]
  today: string
  manage: boolean
  sp: Record<string, string | string[] | undefined>
}) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      <GeneratedValue
        value={entries.map((e) => (
          <li key={e.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_META[e.kind].dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link
                  href={mergeHref(BASE, sp, { drawer: `unit-${e.itemId}` }) as never}
                  scroll={false}
                  className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                >
                  <GeneratedValue value={e.itemName} />
                </Link>
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500">
                  <GeneratedValue value={e.assetTag} />
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  <GeneratedValue value={e.title} />
                </span>
                <Badge variant="secondary">
                  <GeneratedValue value={KIND_META[e.kind].label} />
                </Badge>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_0c2eb92551e08b" />
                <GeneratedValue value={' '} />
                <span
                  className={
                    e.dueOn < today ? 'font-medium text-rose-600 dark:text-rose-400' : undefined
                  }
                >
                  <GeneratedValue value={e.dueOn} />
                </span>
                <GeneratedValue value={e.detail ? ` · ${e.detail}` : ''} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <GeneratedValue
                value={
                  e.startHref ? (
                    <Link href={e.startHref as never}>
                      <Button size="sm" variant="outline">
                        <ClipboardCheck size={14} /> <GeneratedText id="m_144de7fabb13dc" />
                      </Button>
                    </Link>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  e.kind === 'oil_change' ? (
                    <Link href={`/equipment/${e.itemId}?tab=log&drawer=add-log`}>
                      <Button size="sm" variant="outline">
                        <Droplets size={14} /> <GeneratedText id="m_10f6648885696d" />
                      </Button>
                    </Link>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  manage && e.reminderId ? (
                    <>
                      <Link
                        href={mergeHref(BASE, sp, { drawer: `reminder-${e.reminderId}` }) as never}
                        scroll={false}
                        className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                      >
                        <GeneratedText id="m_03a66f9d34ac7b" />
                      </Link>
                      <form action={completeEquipmentReminder}>
                        <input type="hidden" name="id" value={e.reminderId} />
                        <Button size="sm" variant="outline" type="submit">
                          <Check size={14} /> <GeneratedText id="m_00609f822e0571" />
                        </Button>
                      </form>
                    </>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  e.kind === 'reminder' && !manage ? (
                    <BellRing size={14} className="text-slate-300 dark:text-slate-600" />
                  ) : null
                }
              />
            </div>
          </li>
        ))}
      />
    </ul>
  )
}

// Quick-detail flyout for a unit clicked in the work list or calendar — the
// whole maintenance picture without leaving the cockpit.
function UnitMaintenanceDrawer({
  open,
  closeHref,
  unit,
  today,
  manage,
  timeZone,
  locale,
}: {
  open: boolean
  closeHref: string
  unit: UnitDrawerData | null
  today: string
  manage: boolean
  timeZone: string
  locale: AppLocale
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(unit?.item.name ?? tGenerated('m_17f17df74f7e69'))}
      description={tGeneratedValue(
        unit
          ? [unit.item.assetTag, unit.typeName, unit.categoryName].filter(Boolean).join(' · ')
          : undefined,
      )}
      size="lg"
      footer={
        unit ? (
          <Link href={`/equipment/${unit.item.id}?tab=inspections`}>
            <Button>
              <GeneratedText id="m_087428a2c9120b" />
            </Button>
          </Link>
        ) : null
      }
    >
      <GeneratedValue
        value={
          !unit ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_1f993f4f8841df" />
            </p>
          ) : (
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={unit.item.status === 'in_service' ? 'success' : 'warning'}>
                  <GeneratedValue value={String(unit.item.status).replace(/_/g, ' ')} />
                </Badge>
                <GeneratedValue
                  value={
                    unit.item.isMissing ? (
                      <Badge variant="destructive">
                        <GeneratedText id="m_033d838430bc5f" />
                      </Badge>
                    ) : null
                  }
                />
                <span className="text-slate-600 dark:text-slate-300">
                  <GeneratedValue
                    value={unit.siteName ?? <GeneratedText id="m_10d1d0d92a9aaa" />}
                  />
                  <GeneratedValue
                    value={
                      unit.holderName ? (
                        <GeneratedText id="m_121fd3987b36ed" values={{ value0: unit.holderName }} />
                      ) : (
                        ''
                      )
                    }
                  />
                </span>
              </div>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <GeneratedText id="m_0fc16ae9bd180d" />
                  <GeneratedValue value={unit.schedules.length} />)
                </h3>
                <GeneratedValue
                  value={
                    unit.schedules.length === 0 ? (
                      <p className="text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_14d1d0bdbefe41" />
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        <GeneratedValue
                          value={unit.schedules.map((s) => (
                            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                              <div className="min-w-0">
                                <div className="font-medium text-slate-900 dark:text-slate-100">
                                  <GeneratedValue
                                    value={
                                      s.typeName ??
                                      s.label ?? <GeneratedText id="m_0ef24e5f31b073" />
                                    }
                                  />
                                  <GeneratedValue
                                    value={
                                      !s.isActive ? (
                                        <Badge variant="secondary" className="ml-2">
                                          <GeneratedText id="m_07690e88572a6c" />
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  <GeneratedValue
                                    value={formatInterval(s.intervalValue, s.intervalUnit)}
                                  />
                                  <GeneratedValue
                                    value={
                                      s.lastCompletedOn ? (
                                        <GeneratedText
                                          id="m_013806e1709e69"
                                          values={{ value0: s.lastCompletedOn }}
                                        />
                                      ) : (
                                        ''
                                      )
                                    }
                                  />{' '}
                                  <GeneratedText id="m_06460cbdde5c5a" />
                                  <GeneratedValue value={' '} />
                                  <span
                                    className={
                                      s.isActive && s.nextDueOn < today
                                        ? 'font-medium text-rose-600 dark:text-rose-400'
                                        : undefined
                                    }
                                  >
                                    <GeneratedValue value={s.nextDueOn} />
                                  </span>
                                </div>
                              </div>
                              <GeneratedValue
                                value={
                                  s.inspectionTypeId ? (
                                    <Link
                                      href={`/equipment/inspections/new?itemId=${unit.item.id}&typeId=${s.inspectionTypeId}`}
                                    >
                                      <Button size="sm" variant="outline">
                                        <ClipboardCheck size={14} />{' '}
                                        <GeneratedText id="m_144de7fabb13dc" />
                                      </Button>
                                    </Link>
                                  ) : null
                                }
                              />
                            </li>
                          ))}
                        />
                      </ul>
                    )
                  }
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <GeneratedText id="m_1d0f031ad02ec6" />
                  <GeneratedValue
                    value={
                      unit.reminders.length === unit.remindersTotal ? (
                        unit.remindersTotal
                      ) : (
                        <GeneratedText
                          id="m_098d2de6c8b983"
                          values={{ value0: unit.reminders.length, value1: unit.remindersTotal }}
                        />
                      )
                    }
                  />
                  )
                </h3>
                <GeneratedValue
                  value={
                    unit.reminders.length === 0 ? (
                      <p className="text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_0b043686a48300" />
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        <GeneratedValue
                          value={unit.reminders.map((r) => (
                            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                              <div className="min-w-0">
                                <div className="font-medium text-slate-900 dark:text-slate-100">
                                  <GeneratedValue value={r.title} />
                                  <GeneratedValue
                                    value={
                                      r.repeat ? (
                                        <Badge variant="secondary" className="ml-2">
                                          {r.repeat}
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  <GeneratedText id="m_0c2eb92551e08b" />
                                  <GeneratedValue value={' '} />
                                  <span
                                    className={
                                      r.dueOn < today
                                        ? 'font-medium text-rose-600 dark:text-rose-400'
                                        : undefined
                                    }
                                  >
                                    <GeneratedValue value={r.dueOn} />
                                  </span>
                                  <GeneratedValue value={r.assignee ? ` · ${r.assignee}` : ''} />
                                </div>
                              </div>
                              <GeneratedValue
                                value={
                                  manage ? (
                                    <form action={completeEquipmentReminder}>
                                      <input type="hidden" name="id" value={r.id} />
                                      <Button size="sm" variant="outline" type="submit">
                                        <Check size={14} /> <GeneratedText id="m_00609f822e0571" />
                                      </Button>
                                    </form>
                                  ) : null
                                }
                              />
                            </li>
                          ))}
                        />
                      </ul>
                    )
                  }
                />
                <GeneratedValue
                  value={
                    unit.reminders.length < unit.remindersTotal ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_1ebf1e0e84a84c" />
                      </p>
                    ) : null
                  }
                />
              </section>

              <GeneratedValue
                value={
                  unit.item.requiresOilChange ? (
                    <section className="space-y-1">
                      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                        <GeneratedText id="m_181cffe4b37051" />
                      </h3>
                      <p className="text-slate-600 dark:text-slate-300">
                        <GeneratedValue
                          value={
                            unit.item.oilChangeIntervalMonths
                              ? `${formatInterval(unit.item.oilChangeIntervalMonths, 'month')} · `
                              : ''
                          }
                        />
                        <GeneratedValue
                          value={
                            unit.item.lastOilChangeOn ? (
                              <GeneratedText
                                id="m_0adad9941e336d"
                                values={{ value0: unit.item.lastOilChangeOn }}
                              />
                            ) : (
                              ''
                            )
                          }
                        />
                        <GeneratedText id="m_09c5b70a54fbbd" />
                        <GeneratedValue value={' '} />
                        <span
                          className={
                            unit.item.nextOilChangeDue && unit.item.nextOilChangeDue < today
                              ? 'font-medium text-rose-600 dark:text-rose-400'
                              : undefined
                          }
                        >
                          <GeneratedValue value={unit.item.nextOilChangeDue ?? '—'} />
                        </span>
                      </p>
                    </section>
                  ) : null
                }
              />

              <section className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <GeneratedText id="m_0f603593430a93" />
                </h3>
                <GeneratedValue
                  value={
                    unit.inspections.length === 0 ? (
                      <p className="text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_1a945f0976f47b" />
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        <GeneratedValue
                          value={unit.inspections.map((r) => (
                            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                              <Link
                                href={`/equipment/inspections/${r.id}`}
                                className="font-mono text-xs text-teal-700 hover:underline dark:text-teal-400"
                              >
                                <GeneratedValue value={r.reference} />
                              </Link>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                <GeneratedValue
                                  value={formatDate(new Date(r.occurredAt), timeZone, locale)}
                                />
                              </span>
                              <GeneratedValue
                                value={
                                  r.result ? (
                                    <Badge
                                      variant={
                                        r.result === 'pass'
                                          ? 'success'
                                          : r.result === 'fail'
                                            ? 'destructive'
                                            : 'secondary'
                                      }
                                    >
                                      {r.result}
                                    </Badge>
                                  ) : (
                                    <Badge variant="warning">
                                      {String(r.status).replace(/_/g, ' ')}
                                    </Badge>
                                  )
                                }
                              />
                            </li>
                          ))}
                        />
                      </ul>
                    )
                  }
                />
              </section>
            </div>
          )
        }
      />
    </UrlDrawer>
  )
}
