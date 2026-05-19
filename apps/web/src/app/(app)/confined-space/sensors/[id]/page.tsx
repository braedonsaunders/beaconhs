import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { Activity, AlertTriangle, Gauge, Pencil } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import {
  atmosphericCalibrations,
  atmosphericSensors,
  tenantUsers,
  user as userTable,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailPageLayout } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ActivityFeed } from '@/components/activity-feed'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'calibrations', 'activity'] as const
type Tab = (typeof TABS)[number]

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function recordCalibration(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const sensorId = String(formData.get('sensorId') ?? '')
  const calibratedOn = String(formData.get('calibratedOn') ?? '').trim()
  if (!calibratedOn) throw new Error('Calibration date is required')
  const nextDueRaw = String(formData.get('nextCalibrationDue') ?? '').trim()
  const nextDue = nextDueRaw || isoDate(addMonths(new Date(calibratedOn), 6))
  const notes = String(formData.get('notes') ?? '').trim() || null

  await ctx.db(async (tx) => {
    await tx.insert(atmosphericCalibrations).values({
      tenantId: ctx.tenantId,
      sensorId,
      calibratedOn,
      calibratedByTenantUserId: ctx.membership?.id,
      notes,
    })
    await tx
      .update(atmosphericSensors)
      .set({ lastCalibrationOn: calibratedOn, nextCalibrationDue: nextDue })
      .where(eq(atmosphericSensors.id, sensorId))
  })
  await recordAudit(ctx, {
    entityType: 'atmospheric_sensor',
    entityId: sensorId,
    action: 'update',
    summary: `Recorded calibration on ${calibratedOn}`,
    after: { calibratedOn, nextCalibrationDue: nextDue },
  })
  revalidatePath(`/confined-space/sensors/${sensorId}`)
  revalidatePath('/confined-space/sensors')
}

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const sensorId = String(formData.get('sensorId') ?? '')
  const status = String(formData.get('status') ?? '') as 'active' | 'out_of_service' | 'retired'
  if (!['active', 'out_of_service', 'retired'].includes(status)) return
  await ctx.db((tx) =>
    tx.update(atmosphericSensors).set({ status }).where(eq(atmosphericSensors.id, sensorId)),
  )
  await recordAudit(ctx, {
    entityType: 'atmospheric_sensor',
    entityId: sensorId,
    action: 'update',
    summary: `Status changed to "${status.replace(/_/g, ' ')}"`,
    after: { status },
  })
  revalidatePath(`/confined-space/sensors/${sensorId}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Sensor · ${id.slice(0, 8)}` }
}

export default async function SensorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [sensor] = await tx
      .select()
      .from(atmosphericSensors)
      .where(eq(atmosphericSensors.id, id))
      .limit(1)
    if (!sensor) return null
    const calibrations = await tx
      .select({ cal: atmosphericCalibrations, tenantUser: tenantUsers, account: userTable })
      .from(atmosphericCalibrations)
      .leftJoin(tenantUsers, eq(tenantUsers.id, atmosphericCalibrations.calibratedByTenantUserId))
      .leftJoin(userTable, eq(userTable.id, tenantUsers.userId))
      .where(eq(atmosphericCalibrations.sensorId, id))
      .orderBy(desc(atmosphericCalibrations.calibratedOn))
    return { sensor, calibrations }
  })

  if (!data) notFound()
  const { sensor, calibrations } = data
  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'atmospheric_sensor', id, 50) : []

  const today = new Date()
  const nextDue = sensor.nextCalibrationDue ? new Date(sensor.nextCalibrationDue) : null
  const daysToDue = nextDue
    ? Math.round((nextDue.getTime() - today.getTime()) / 86_400_000)
    : null
  const overdue = daysToDue !== null && daysToDue < 0
  const soon = daysToDue !== null && daysToDue >= 0 && daysToDue <= 30

  const calStatus: { variant: 'success' | 'warning' | 'destructive' | 'secondary'; label: string } =
    overdue
      ? { variant: 'destructive', label: `Overdue ${Math.abs(daysToDue!)}d` }
      : soon
        ? { variant: 'warning', label: `Due in ${daysToDue}d` }
        : daysToDue !== null
          ? { variant: 'success', label: `OK · ${daysToDue}d` }
          : { variant: 'secondary', label: 'Never calibrated' }

  const basePath = `/confined-space/sensors/${id}`

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/confined-space/sensors', label: 'Back to sensors' }}
          title={sensor.identifier}
          subtitle={[sensor.make, sensor.model].filter(Boolean).join(' ') || undefined}
          badge={
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  sensor.status === 'active'
                    ? 'success'
                    : sensor.status === 'retired'
                      ? 'secondary'
                      : 'warning'
                }
              >
                {sensor.status.replace(/_/g, ' ')}
              </Badge>
              <Badge variant={calStatus.variant}>{calStatus.label}</Badge>
            </div>
          }
          actions={
            <Link href={`/confined-space/sensors/${id}/edit`}>
              <Button variant="outline">
                <Pencil size={14} />
                Edit
              </Button>
            </Link>
          }
        />
      }
      alerts={
        overdue ? (
          <Alert variant="destructive">
            <AlertTitle className="flex items-center gap-2">
              <AlertTriangle size={16} /> Calibration overdue
            </AlertTitle>
            <AlertDescription>
              This sensor was due for calibration {Math.abs(daysToDue!)} days ago. Do not issue
              until it has been bumped and span calibrated.
            </AlertDescription>
          </Alert>
        ) : soon ? (
          <Alert variant="warning">
            <AlertTitle>Calibration coming up</AlertTitle>
            <AlertDescription>
              Next calibration due in {daysToDue} days ({sensor.nextCalibrationDue}).
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'calibrations', label: 'Calibrations', count: calibrations.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Card>
            <CardHeader>
              <CardTitle>Sensor details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailGrid
                rows={[
                  { label: 'Identifier', value: sensor.identifier },
                  { label: 'Make', value: sensor.make ?? '—' },
                  { label: 'Model', value: sensor.model ?? '—' },
                  { label: 'Serial #', value: sensor.serialNumber ?? '—' },
                  { label: 'Type', value: sensor.type.replace(/_/g, ' ') },
                  {
                    label: 'Gases',
                    value:
                      sensor.gases.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {sensor.gases.map((g) => (
                            <Badge key={g} variant="secondary">
                              {g}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        '—'
                      ),
                  },
                  { label: 'Last calibration', value: sensor.lastCalibrationOn ?? '—' },
                  { label: 'Next calibration due', value: sensor.nextCalibrationDue ?? '—' },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateStatus} className="space-y-2">
                <input type="hidden" name="sensorId" value={id} />
                <Label>Move to</Label>
                <select
                  name="status"
                  defaultValue={sensor.status}
                  className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="out_of_service">Out of service</option>
                  <option value="retired">Retired</option>
                </select>
                <Button type="submit" className="w-full">
                  Update status
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {active === 'calibrations' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Calibration history ({calibrations.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {calibrations.length === 0 ? (
                <EmptyState
                  icon={<Gauge size={24} />}
                  title="No calibrations recorded"
                  description="Record the first calibration below."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Calibrated on</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calibrations.map((c) => (
                      <TableRow key={c.cal.id}>
                        <TableCell>{c.cal.calibratedOn}</TableCell>
                        <TableCell className="text-slate-600">
                          {c.account?.name ?? c.tenantUser?.displayName ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600">{c.cal.notes ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Record calibration</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={recordCalibration} className="space-y-3">
                <input type="hidden" name="sensorId" value={id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>
                      Calibrated on <span className="text-red-600">*</span>
                    </Label>
                    <Input
                      name="calibratedOn"
                      type="date"
                      required
                      defaultValue={today.toISOString().slice(0, 10)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Next due (defaults to +6 months)</Label>
                    <Input
                      name="nextCalibrationDue"
                      type="date"
                      defaultValue={isoDate(addMonths(today, 6))}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Notes</Label>
                    <Textarea
                      name="notes"
                      rows={2}
                      placeholder="Span gas batch, technician, observations"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit">
                    <Activity size={14} /> Record calibration
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {active === 'activity' ? (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed entries={activity} />
          </CardContent>
        </Card>
      ) : null}
    </DetailPageLayout>
  )
}
