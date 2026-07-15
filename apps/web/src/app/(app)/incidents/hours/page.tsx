import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// /incidents/hours — periodic hours-worked tracker. Drives every frequency-rate
// calc (TRIR / DART / LTIR).
//
// Standard table primitive for the list; create + edit happen in a right-side
// flyout (?drawer=new | ?drawer=<id>). Delete stays as a row action.

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Plus, Trash2 } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { incidentHoursPeriods, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { IncidentsSubNav } from '../_sub-nav'
import { HoursDrawer, type HoursEditing } from './_drawers'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_04dae76323fbd5') }
}
export const dynamic = 'force-dynamic'

const BASE = '/incidents/hours'
const SORTS = ['period', 'hours', 'employees'] as const

async function saveHoursPeriod(input: {
  id?: string
  periodLabel: string | null
  periodStart: string
  periodEnd: string
  siteOrgUnitId: string | null
  totalHours: number
  employeeCount: number
  notes: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  if (!input.periodStart || !input.periodEnd)
    return { ok: false, error: 'Start and end dates are required.' }
  if (!Number.isFinite(input.totalHours) || input.totalHours <= 0)
    return { ok: false, error: 'Total hours must be greater than zero.' }
  if (!Number.isFinite(input.employeeCount) || input.employeeCount <= 0)
    return { ok: false, error: 'Employee count must be greater than zero.' }

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(incidentHoursPeriods)
        .where(eq(incidentHoursPeriods.id, input.id!))
        .limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Hours period not found.' }
    await ctx.db((tx) =>
      tx
        .update(incidentHoursPeriods)
        .set({
          siteOrgUnitId: input.siteOrgUnitId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          periodLabel: input.periodLabel,
          totalHours: input.totalHours.toFixed(2),
          employeeCount: input.employeeCount,
          notes: input.notes,
        })
        .where(eq(incidentHoursPeriods.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_hours_period',
      entityId: input.id,
      action: 'update',
      summary: `Updated hours entry (${input.periodStart} → ${input.periodEnd})`,
      before: { totalHours: before.totalHours, employeeCount: before.employeeCount },
      after: { totalHours: input.totalHours, employeeCount: input.employeeCount },
    })
  } else {
    const [row] = await ctx.db((tx) =>
      tx
        .insert(incidentHoursPeriods)
        .values({
          tenantId: ctx.tenantId,
          siteOrgUnitId: input.siteOrgUnitId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          periodLabel: input.periodLabel,
          totalHours: input.totalHours.toFixed(2),
          employeeCount: input.employeeCount,
          notes: input.notes,
          enteredByTenantUserId: ctx.membership?.id ?? null,
        })
        .returning(),
    )
    if (row) {
      await recordAudit(ctx, {
        entityType: 'incident_hours_period',
        entityId: row.id,
        action: 'create',
        summary: `Logged ${input.totalHours.toLocaleString()} hours (${input.periodStart} → ${input.periodEnd})`,
        after: {
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          totalHours: input.totalHours,
          employeeCount: input.employeeCount,
          periodLabel: input.periodLabel,
        },
      })
    }
  }
  revalidatePath(BASE)
  return { ok: true }
}

async function deletePeriod(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentHoursPeriods)
      .where(eq(incidentHoursPeriods.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) return
  await ctx.db((tx) => tx.delete(incidentHoursPeriods).where(eq(incidentHoursPeriods.id, id)))
  await recordAudit(ctx, {
    entityType: 'incident_hours_period',
    entityId: id,
    action: 'delete',
    summary: `Deleted hours entry (${before.periodStart} → ${before.periodEnd})`,
    before: { totalHours: before.totalHours, employeeCount: before.employeeCount },
  })
  revalidatePath(BASE)
}

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'period',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const drawerParam = pickString(sp.drawer)
  const siteParam = pickString(sp.site)
  const ctx = await requireModuleManage('incidents')

  const dir = params.dir === 'asc' ? asc : desc
  const orderBy =
    params.sort === 'hours'
      ? dir(incidentHoursPeriods.totalHours)
      : params.sort === 'employees'
        ? dir(incidentHoursPeriods.employeeCount)
        : dir(incidentHoursPeriods.periodStart)

  const { rows, sites, total, totalHours } = await ctx.db(async (tx) => {
    const siteRows = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const selectedSiteId = siteRows.some((site) => site.id === siteParam) ? siteParam : undefined
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(incidentHoursPeriods.periodLabel, `%${params.q}%`),
          ilike(orgUnits.name, `%${params.q}%`),
          sql`${incidentHoursPeriods.periodStart}::text ilike ${`%${params.q}%`}`,
          sql`${incidentHoursPeriods.periodEnd}::text ilike ${`%${params.q}%`}`,
        )
      : undefined
    const siteFilter =
      siteParam === 'unassigned'
        ? isNull(incidentHoursPeriods.siteOrgUnitId)
        : selectedSiteId
          ? eq(incidentHoursPeriods.siteOrgUnitId, selectedSiteId)
          : undefined
    const where = and(search, siteFilter)
    const [summary] = await tx
      .select({
        total: count(),
        totalHours: sql<string>`coalesce(sum(${incidentHoursPeriods.totalHours}), 0)`,
      })
      .from(incidentHoursPeriods)
      .leftJoin(orgUnits, eq(orgUnits.id, incidentHoursPeriods.siteOrgUnitId))
      .where(where)
    const data = await tx
      .select({ period: incidentHoursPeriods, site: orgUnits })
      .from(incidentHoursPeriods)
      .leftJoin(orgUnits, eq(orgUnits.id, incidentHoursPeriods.siteOrgUnitId))
      .where(where)
      .orderBy(orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return {
      rows: data,
      sites: siteRows,
      total: Number(summary?.total ?? 0),
      totalHours: Number(summary?.totalHours ?? 0),
    }
  })

  const hasFilters = Boolean(params.q || siteParam)

  const today = new Date().toISOString().slice(0, 10)
  const lastMonthStart = new Date()
  lastMonthStart.setDate(1)
  lastMonthStart.setMonth(lastMonthStart.getMonth() - 1)
  const lastMonthEnd = new Date()
  lastMonthEnd.setDate(0)
  const defaults = {
    today,
    start: lastMonthStart.toISOString().slice(0, 10),
    end: lastMonthEnd.toISOString().slice(0, 10),
    label: lastMonthStart.toLocaleString(ctx.locale, { month: 'long', year: 'numeric' }),
  }

  const editingRow =
    drawerParam && drawerParam !== 'new' ? rows.find((r) => r.period.id === drawerParam) : undefined
  const editing: HoursEditing | null = editingRow
    ? {
        id: editingRow.period.id,
        periodLabel: editingRow.period.periodLabel,
        periodStart: editingRow.period.periodStart,
        periodEnd: editingRow.period.periodEnd,
        siteOrgUnitId: editingRow.period.siteOrgUnitId,
        totalHours: editingRow.period.totalHours,
        employeeCount: editingRow.period.employeeCount,
        notes: editingRow.period.notes,
      }
    : null
  const mode: 'new' | 'edit' | null = drawerParam === 'new' ? 'new' : editing ? 'edit' : null
  const closeHref = mergeHref(BASE, sp, { drawer: undefined })
  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_04dae76323fbd5')}
            description={tGenerated('m_0206cae9049c31')}
            actions={
              <Link href={mergeHref(BASE, sp, { drawer: 'new' }) as any} scroll={false}>
                <Button>
                  <Plus size={14} /> <GeneratedText id="m_1f98e43ebaf016" />
                </Button>
              </Link>
            }
          />
          <IncidentsSubNav active="hours" />
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
            <Stat label={tGenerated('m_150e10bc14ef29')} value={total.toLocaleString()} />
            <Stat label={tGenerated('m_19256885a442f5')} value={totalHours.toLocaleString()} />
          </div>
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_09fb5ab487381c')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="site"
              label={tGenerated('m_020146dd3d3d5a')}
              options={[
                ...sites.map((site) => ({ value: site.id, label: site.name })),
                { value: 'unassigned', label: 'All-sites entries' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Plus size={32} />}
              title={tGeneratedValue(
                hasFilters ? tGenerated('m_1a061432335e88') : tGenerated('m_10ebafd50a190c'),
              )}
              description={tGeneratedValue(
                hasFilters ? tGenerated('m_1369998269c756') : tGenerated('m_0c8a85fa04fec4'),
              )}
              action={
                <Link href={mergeHref(BASE, sp, { drawer: 'new' }) as any} scroll={false}>
                  <Button>
                    <GeneratedText id="m_1f98e43ebaf016" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh {...sortProps} column="period" active={params.sort === 'period'}>
                    <GeneratedText id="m_1ec8c0e767ebe2" />
                  </SortableTh>
                  <TableHead>
                    <GeneratedText id="m_1d088977412efb" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_020146dd3d3d5a" />
                  </TableHead>
                  <SortableTh
                    {...sortProps}
                    column="hours"
                    active={params.sort === 'hours'}
                    align="right"
                    className="text-right"
                  >
                    <GeneratedText id="m_192ca43bd9c999" />
                  </SortableTh>
                  <SortableTh
                    {...sortProps}
                    column="employees"
                    active={params.sort === 'employees'}
                    align="right"
                    className="text-right"
                  >
                    <GeneratedText id="m_0302a7e2443143" />
                  </SortableTh>
                  <TableHead className="text-right">
                    <GeneratedText id="m_0a7f1858f2ec46" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <GeneratedValue
                  value={rows.map(({ period, site }) => {
                    const editHref = mergeHref(BASE, sp, { drawer: period.id })
                    return (
                      <TableRow key={period.id}>
                        <TableCell className="text-sm">
                          <Link href={editHref as any} scroll={false} className="hover:underline">
                            <span className="font-mono text-xs">
                              <GeneratedValue value={period.periodStart} />
                            </span>
                            <span className="text-slate-400"> → </span>
                            <span className="font-mono text-xs">
                              <GeneratedValue value={period.periodEnd} />
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue
                            value={period.periodLabel ?? <span className="text-slate-400">—</span>}
                          />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue
                            value={
                              site ? (
                                <Badge variant="secondary">
                                  <GeneratedValue value={site.name} />
                                </Badge>
                              ) : (
                                <span className="text-xs text-slate-400">
                                  <GeneratedText id="m_1f5ad6ec6b5d2a" />
                                </span>
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <GeneratedValue value={Number(period.totalHours).toLocaleString()} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <GeneratedValue value={period.employeeCount} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <Link
                              href={editHref as any}
                              scroll={false}
                              className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                            >
                              <GeneratedText id="m_03a66f9d34ac7b" />
                            </Link>
                            <form action={deletePeriod} className="inline">
                              <input type="hidden" name="id" value={period.id} />
                              <button
                                type="submit"
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                title={tGenerated('m_11773f3c3f7558')}
                              >
                                <Trash2 size={14} />
                              </button>
                            </form>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                />
              </TableBody>
            </Table>
          )
        }
      />

      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />

      <HoursDrawer
        mode={mode}
        editing={editing}
        sites={sites}
        defaults={defaults}
        closeHref={closeHref}
        saveAction={saveHoursPeriod}
      />
    </ListPageLayout>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-800 dark:bg-slate-900">
      <span className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={label} />:<GeneratedValue value={' '} />
      </span>
      <span className="font-medium tabular-nums">
        <GeneratedValue value={value} />
      </span>
    </span>
  )
}
