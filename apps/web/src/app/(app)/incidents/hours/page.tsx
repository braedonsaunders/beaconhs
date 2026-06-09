// /incidents/hours — periodic hours-worked tracker.  Drives every
// frequency-rate calc (TRIR / DART / LTIR).
//
// List of windows on top; new-entry form below.  Each row spans an
// arbitrary date range with a human-readable label.

import { revalidatePath } from 'next/cache'
import { Plus, Trash2 } from 'lucide-react'
import { asc, desc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { incidentHoursPeriods, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { IncidentsSubNav } from '../_sub-nav'

export const metadata = { title: 'Hours worked' }
export const dynamic = 'force-dynamic'

async function createPeriod(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const periodStart = String(formData.get('periodStart') ?? '').trim()
  const periodEnd = String(formData.get('periodEnd') ?? '').trim()
  const totalHoursRaw = String(formData.get('totalHours') ?? '').trim()
  const employeeCountRaw = String(formData.get('employeeCount') ?? '').trim()
  const periodLabel = String(formData.get('periodLabel') ?? '').trim() || null
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!periodStart || !periodEnd) return
  const totalHours = Number(totalHoursRaw)
  const employeeCount = parseInt(employeeCountRaw, 10)
  if (!Number.isFinite(totalHours) || totalHours <= 0) return
  if (!Number.isFinite(employeeCount) || employeeCount <= 0) return

  const [row] = await ctx.db((tx) =>
    tx
      .insert(incidentHoursPeriods)
      .values({
        tenantId: ctx.tenantId,
        siteOrgUnitId,
        periodStart,
        periodEnd,
        periodLabel,
        totalHours: totalHours.toFixed(2),
        employeeCount,
        notes,
        enteredByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'incident_hours_period',
      entityId: row.id,
      action: 'create',
      summary: `Logged ${totalHours.toLocaleString()} hours (${periodStart} → ${periodEnd})`,
      after: { periodStart, periodEnd, totalHours, employeeCount, periodLabel },
    })
  }
  revalidatePath('/incidents/hours')
  revalidatePath('/incidents/reports/frequency')
  revalidatePath('/incidents/reports/severity')
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
  await ctx.db((tx) =>
    tx.delete(incidentHoursPeriods).where(eq(incidentHoursPeriods.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident_hours_period',
    entityId: id,
    action: 'delete',
    summary: `Deleted hours entry (${before.periodStart} → ${before.periodEnd})`,
    before: {
      totalHours: before.totalHours,
      employeeCount: before.employeeCount,
    },
  })
  revalidatePath('/incidents/hours')
  revalidatePath('/incidents/reports/frequency')
}

export default async function HoursPage() {
  const ctx = await requireModuleManage('incidents')
  const { rows, sites } = await ctx.db(async (tx) => {
    const all = await tx
      .select({
        period: incidentHoursPeriods,
        site: orgUnits,
      })
      .from(incidentHoursPeriods)
      .leftJoin(orgUnits, eq(orgUnits.id, incidentHoursPeriods.siteOrgUnitId))
      .orderBy(desc(incidentHoursPeriods.periodStart))
    const siteRows = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    return { rows: all, sites: siteRows }
  })

  const totalRecorded = rows.reduce((sum, r) => sum + Number(r.period.totalHours), 0)
  const periodCount = rows.length
  const today = new Date().toISOString().slice(0, 10)
  const lastMonthStart = new Date()
  lastMonthStart.setDate(1)
  lastMonthStart.setMonth(lastMonthStart.getMonth() - 1)
  const lastMonthEnd = new Date()
  lastMonthEnd.setDate(0)
  const defaultStart = lastMonthStart.toISOString().slice(0, 10)
  const defaultEnd = lastMonthEnd.toISOString().slice(0, 10)
  const defaultLabel = `${lastMonthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' })}`

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Hours worked"
            description="Periodic hours-worked tally. Every frequency-rate report (TRIR, DART, LTIR) divides into the sum of these windows."
          />
          <IncidentsSubNav active="hours" />
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <Stat label="Periods logged" value={periodCount.toLocaleString()} />
            <Stat label="Hours total" value={totalRecorded.toLocaleString()} />
            <span className="text-xs text-slate-400">
              (TRIR = recordable count × 200 000 / total hours)
            </span>
          </div>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Plus size={32} />}
              title="No periods logged yet"
              description="Add a window — typically one entry per site per month — so the frequency-rate reports have a denominator."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ period, site }) => (
                  <TableRow key={period.id}>
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs">{period.periodStart}</span>
                      <span className="text-slate-400"> → </span>
                      <span className="font-mono text-xs">{period.periodEnd}</span>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {period.periodLabel ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {site ? (
                        <Badge variant="secondary">{site.name}</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">All sites</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(period.totalHours).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {period.employeeCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={deletePeriod} className="inline">
                        <input type="hidden" name="id" value={period.id} />
                        <button
                          type="submit"
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Add period</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createPeriod} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="periodLabel">Label</Label>
                  <Input
                    id="periodLabel"
                    name="periodLabel"
                    defaultValue={defaultLabel}
                    placeholder="Month, quarter, project name…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="periodStart">Start *</Label>
                    <Input
                      id="periodStart"
                      name="periodStart"
                      type="date"
                      required
                      defaultValue={defaultStart}
                      max={today}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="periodEnd">End *</Label>
                    <Input
                      id="periodEnd"
                      name="periodEnd"
                      type="date"
                      required
                      defaultValue={defaultEnd}
                      max={today}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="siteOrgUnitId">Site</Label>
                  <Select id="siteOrgUnitId" name="siteOrgUnitId" defaultValue="">
                    <option value="">All sites (tenant-wide)</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="totalHours">Total hours *</Label>
                    <Input
                      id="totalHours"
                      name="totalHours"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      placeholder="e.g. 12450"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="employeeCount">Employees *</Label>
                    <Input
                      id="employeeCount"
                      name="employeeCount"
                      type="number"
                      min="1"
                      step="1"
                      required
                      placeholder="Avg count"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" rows={2} placeholder="Optional context" />
                </div>
                <div className="flex justify-end">
                  <Button type="submit">
                    <Plus size={14} /> Add
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Frequency rates explained</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <div>
                <strong>TRIR</strong> = (recordable incidents × 200 000) / hours worked. Industry
                benchmark in construction = ~3.0.
              </div>
              <div>
                <strong>DART</strong> = (days-away/restricted/transferred incidents × 200 000) /
                hours worked.
              </div>
              <div>
                <strong>LTIR</strong> = (lost-time incidents × 200 000) / hours worked.
              </div>
              <p>
                Multiplier 200 000 ≈ 100 full-time employees × 40 h × 50 weeks. The same
                divisor is used by OSHA, BLS, ANSI Z16.4, and CSA Z1000.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </ListPageLayout>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}: </span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  )
}
