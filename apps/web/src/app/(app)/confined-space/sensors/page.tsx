import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Gauge, Pencil } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
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
import { atmosphericSensors } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import {
  SensorDrawers,
  type EditSensorDefaults,
  type SensorStatus,
  type SensorType,
} from './_drawers'

export const metadata = { title: 'Atmospheric Sensors' }

const SORTS = ['identifier', 'status', 'next_due', 'last_calibration'] as const

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'retired', label: 'Retired' },
]

const DUE_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'soon', label: 'Due within 30d' },
]

// ---------- Server actions (drawer-driven, typed object inputs) ----------

async function createSensorAction(input: {
  identifier: string
  make: string | null
  model: string | null
  serialNumber: string | null
  type: SensorType
  gases: string[]
  lastCalibrationOn: string | null
  nextCalibrationDue: string | null
  status: SensorStatus
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const identifier = input.identifier.trim()
  if (!identifier) return { ok: false, error: 'Identifier is required' }
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(atmosphericSensors)
      .values({
        tenantId: ctx.tenantId!,
        identifier,
        make: input.make,
        model: input.model,
        serialNumber: input.serialNumber,
        type: input.type,
        gases: input.gases,
        lastCalibrationOn: input.lastCalibrationOn,
        nextCalibrationDue: input.nextCalibrationDue,
        status: input.status,
      })
      .returning()
    return r
  })
  if (!row) return { ok: false, error: 'Failed to register sensor' }
  await recordAudit(ctx, {
    entityType: 'atmospheric_sensor',
    entityId: row.id,
    action: 'create',
    summary: `Registered sensor ${identifier}`,
    after: {
      identifier,
      make: input.make,
      model: input.model,
      type: input.type,
      gases: input.gases,
      status: input.status,
    },
  })
  revalidatePath('/confined-space/sensors')
  return { ok: true, id: row.id }
}

async function updateSensorAction(input: {
  id: string
  identifier: string
  make: string | null
  model: string | null
  serialNumber: string | null
  type: SensorType
  gases: string[]
  status: SensorStatus
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  if (!input.id) return { ok: false, error: 'Missing sensor id' }
  const identifier = input.identifier.trim()
  if (!identifier) return { ok: false, error: 'Identifier is required' }
  await ctx.db((tx) =>
    tx
      .update(atmosphericSensors)
      .set({
        identifier,
        make: input.make,
        model: input.model,
        serialNumber: input.serialNumber,
        type: input.type,
        gases: input.gases,
        status: input.status,
      })
      .where(eq(atmosphericSensors.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'atmospheric_sensor',
    entityId: input.id,
    action: 'update',
    summary: 'Sensor details updated',
    after: {
      identifier,
      make: input.make,
      model: input.model,
      type: input.type,
      gases: input.gases,
      status: input.status,
    },
  })
  revalidatePath(`/confined-space/sensors/${input.id}`)
  revalidatePath('/confined-space/sensors')
  return { ok: true }
}

export default async function SensorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'next_due',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const dueFilter = pickString(sp.due)
  const drawer = pickString(sp.drawer)
  const editId = pickString(sp.id)
  const ctx = await requireRequestContext()

  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const in30Iso = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10)

  const { rows, total, statusCounts, editTarget } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(atmosphericSensors.identifier, term),
        ilike(atmosphericSensors.make, term),
        ilike(atmosphericSensors.model, term),
        ilike(atmosphericSensors.serialNumber, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(atmosphericSensors.status, statusFilter as any))
    if (dueFilter === 'overdue') {
      filters.push(sql`${atmosphericSensors.nextCalibrationDue} < ${todayIso}`)
    } else if (dueFilter === 'soon') {
      filters.push(
        sql`${atmosphericSensors.nextCalibrationDue} >= ${todayIso} AND ${atmosphericSensors.nextCalibrationDue} <= ${in30Iso}`,
      )
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'identifier'
        ? [
            params.dir === 'asc'
              ? asc(atmosphericSensors.identifier)
              : desc(atmosphericSensors.identifier),
          ]
        : params.sort === 'status'
          ? [
              params.dir === 'asc'
                ? asc(atmosphericSensors.status)
                : desc(atmosphericSensors.status),
            ]
          : params.sort === 'last_calibration'
            ? [
                params.dir === 'asc'
                  ? asc(atmosphericSensors.lastCalibrationOn)
                  : desc(atmosphericSensors.lastCalibrationOn),
              ]
            : [
                params.dir === 'asc'
                  ? asc(atmosphericSensors.nextCalibrationDue)
                  : desc(atmosphericSensors.nextCalibrationDue),
              ]

    const [tot] = await tx.select({ c: count() }).from(atmosphericSensors).where(whereClause)
    const data = await tx
      .select()
      .from(atmosphericSensors)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ s: atmosphericSensors.status, c: count() })
      .from(atmosphericSensors)
      .groupBy(atmosphericSensors.status)
    let editTarget: EditSensorDefaults | null = null
    if (drawer === 'edit-sensor' && editId) {
      const [target] = await tx
        .select()
        .from(atmosphericSensors)
        .where(eq(atmosphericSensors.id, editId))
        .limit(1)
      if (target) {
        editTarget = {
          id: target.id,
          identifier: target.identifier,
          make: target.make,
          model: target.model,
          serialNumber: target.serialNumber,
          type: target.type as SensorType,
          gases: target.gases,
          status: target.status as SensorStatus,
        }
      }
    }

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      editTarget,
    }
  })

  const sortProps = { basePath: '/confined-space/sensors', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Atmospheric Sensors"
            description="Gas monitors used for confined-space entry. Calibrations are tracked so you can flag overdue sensors before issue."
            actions={
              <Link href="/confined-space/sensors?drawer=new-sensor" scroll={false}>
                <Button>New sensor</Button>
              </Link>
            }
          />
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/confined-space"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Permits
            </Link>
            <Link
              href="/confined-space/sensors"
              className="rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700"
            >
              Atmospheric sensors
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search by identifier, make, model, or serial #" />
          </div>
          <div className="flex flex-wrap gap-3">
            <FilterChips
              basePath="/confined-space/sensors"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/confined-space/sensors"
              currentParams={sp}
              paramKey="due"
              label="Calibration"
              options={DUE_OPTIONS}
            />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Gauge size={32} />}
          title={params.q ? `No sensors match "${params.q}"` : 'No sensors yet'}
          description="Register a sensor to start tracking its calibration history."
          action={
            <Link href="/confined-space/sensors?drawer=new-sensor" scroll={false}>
              <Button>New sensor</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  {...sortProps}
                  column="identifier"
                  active={params.sort === 'identifier'}
                >
                  Identifier
                </SortableTh>
                <TableHead>Make / Model</TableHead>
                <TableHead>Gases</TableHead>
                <SortableTh
                  {...sortProps}
                  column="last_calibration"
                  active={params.sort === 'last_calibration'}
                >
                  Last cal
                </SortableTh>
                <SortableTh {...sortProps} column="next_due" active={params.sort === 'next_due'}>
                  Next due
                </SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const nextDue = s.nextCalibrationDue ? new Date(s.nextCalibrationDue) : null
                const daysToDue = nextDue
                  ? Math.round((nextDue.getTime() - today.getTime()) / 86_400_000)
                  : null
                const overdue = daysToDue !== null && daysToDue < 0
                const soon = daysToDue !== null && daysToDue >= 0 && daysToDue <= 30
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/confined-space/sensors/${s.id}`}
                        className="font-mono text-sm font-medium text-slate-900 hover:underline"
                      >
                        {s.identifier}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {[s.make, s.model].filter(Boolean).join(' ') || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {s.gases.length > 0 ? s.gases.join(', ') : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">{s.lastCalibrationOn ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600">{s.nextCalibrationDue ?? '—'}</span>
                        {overdue ? (
                          <Badge variant="destructive">
                            Overdue {Math.abs(daysToDue!)}d
                          </Badge>
                        ) : soon ? (
                          <Badge variant="warning">{daysToDue}d</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          s.status === 'active'
                            ? 'success'
                            : s.status === 'retired'
                              ? 'secondary'
                              : 'warning'
                        }
                      >
                        {s.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/confined-space/sensors?drawer=edit-sensor&id=${s.id}`}
                        scroll={false}
                        aria-label={`Edit ${s.identifier}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      >
                        <Pencil size={14} />
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/confined-space/sensors"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <SensorDrawers
        openDrawer={
          drawer === 'new-sensor'
            ? 'new-sensor'
            : drawer === 'edit-sensor'
              ? 'edit-sensor'
              : null
        }
        closeHref="/confined-space/sensors"
        createAction={createSensorAction}
        updateAction={updateSensorAction}
        editDefaults={editTarget}
      />
    </ListPageLayout>
  )
}
