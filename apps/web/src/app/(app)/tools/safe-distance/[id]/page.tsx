import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
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
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  orgUnits,
  people,
  safeDistanceRecords,
  tenantUsers,
  user as userTable,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  deleteSafeDistanceRecordAndRedirect,
  toggleLockSafeDistanceRecord,
  updateSafeDistanceRecordForm,
} from '../_actions'
import {
  formatDistance,
  formatVoltage,
  SAFE_DISTANCE_TYPE_LABELS,
  type SafeDistanceType,
} from '../_lib'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'edit', 'activity'] as const
type Tab = (typeof TABS)[number]

export default async function SafeDistanceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const tab = pickActiveTab<Tab>(sp, TABS, 'overview')
  const ctx = await requireRequestContext()

  const detail = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(safeDistanceRecords)
      .where(eq(safeDistanceRecords.id, id))
      .limit(1)
    if (!row) return null
    const [site] = row.siteOrgUnitId
      ? await tx
          .select({ id: orgUnits.id, name: orgUnits.name })
          .from(orgUnits)
          .where(eq(orgUnits.id, row.siteOrgUnitId))
          .limit(1)
      : []
    const [supervisor] = row.supervisorTenantUserId
      ? await tx
          .select({ id: tenantUsers.id, name: tenantUsers.displayName })
          .from(tenantUsers)
          .where(eq(tenantUsers.id, row.supervisorTenantUserId))
          .limit(1)
      : []
    const [operator] = row.operatorPersonId
      ? await tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
          })
          .from(people)
          .where(eq(people.id, row.operatorPersonId))
          .limit(1)
      : []
    return { row, site, supervisor, operator }
  })

  if (!detail) notFound()
  const { row, site, supervisor, operator } = detail

  // Dropdown sources for the edit tab — only fetched when needed but the
  // overhead of two extra reads on overview is negligible vs. round-tripping
  // through a separate route.
  const sources =
    tab === 'edit'
      ? await ctx.db(async (tx) => {
          const sites = await tx
            .select({ id: orgUnits.id, name: orgUnits.name })
            .from(orgUnits)
            .where(eq(orgUnits.level, 'site'))
            .orderBy(asc(orgUnits.name))
            .limit(200)
          const supervisors = await tx
            .select({ id: tenantUsers.id, name: tenantUsers.displayName, email: userTable.email })
            .from(tenantUsers)
            .leftJoin(userTable, eq(userTable.id, tenantUsers.userId))
            .where(eq(tenantUsers.status, 'active'))
            .orderBy(asc(tenantUsers.displayName))
            .limit(200)
          const operators = await tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              employeeNo: people.employeeNo,
            })
            .from(people)
            .where(eq(people.status, 'active'))
            .orderBy(asc(people.lastName), asc(people.firstName))
            .limit(500)
          return { sites, supervisors, operators }
        })
      : null

  const activity =
    tab === 'activity'
      ? await recentActivityForEntity(ctx, 'safe_distance_record', row.id, 100)
      : []

  const subtabs = (
    <TabNav
      basePath={`/tools/safe-distance/${row.id}`}
      currentParams={sp}
      tabs={[
        { key: 'overview', label: 'Overview' },
        { key: 'edit', label: 'Edit', hidden: row.locked },
        { key: 'activity', label: 'Activity' },
      ]}
      active={tab}
    />
  )

  const lockedBadge = row.locked ? (
    <Badge variant="secondary">Locked</Badge>
  ) : (
    <Badge variant="outline">Unlocked</Badge>
  )
  const complianceBadge = row.complies ? (
    <Badge variant="success">Compliant</Badge>
  ) : (
    <Badge variant="destructive">Non-compliant</Badge>
  )

  const header = (
    <DetailHeader
      back={{ href: '/tools/safe-distance', label: 'All assessments' }}
      title={row.reference}
      subtitle={
        SAFE_DISTANCE_TYPE_LABELS[row.type as SafeDistanceType] +
        (row.sourceDescription ? ` — ${row.sourceDescription}` : '')
      }
      badge={
        <div className="flex items-center gap-2">
          {complianceBadge}
          {lockedBadge}
        </div>
      }
      actions={
        <div className="flex items-center gap-2">
          <Link href={`/tools/safe-distance/${row.id}/print`} target="_blank">
            <Button variant="outline">Print / PDF</Button>
          </Link>
          <form action={toggleLockSafeDistanceRecord}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="desired" value={row.locked ? 'false' : 'true'} />
            <Button variant="outline" type="submit">
              {row.locked ? 'Unlock' : 'Lock'}
            </Button>
          </form>
          {row.locked ? null : (
            <form action={deleteSafeDistanceRecordAndRedirect}>
              <input type="hidden" name="id" value={row.id} />
              <Button variant="outline" type="submit">
                Delete
              </Button>
            </form>
          )}
        </div>
      }
    />
  )

  return (
    <DetailPageLayout
      header={header}
      alerts={
        row.complies ? null : (
          <Alert variant="destructive">
            <AlertTitle>Non-compliant</AlertTitle>
            <AlertDescription>
              Actual {formatDistance(row.actualDistanceM)} is below the required{' '}
              {formatDistance(row.requiredDistanceM)}. Consider opening a corrective action.
            </AlertDescription>
          </Alert>
        )
      }
      subtabs={subtabs}
    >
      {tab === 'overview' ? (
        <div className="space-y-4">
          <Section title="Measurements">
            <DetailGrid
              rows={[
                {
                  label: 'Type',
                  value: SAFE_DISTANCE_TYPE_LABELS[row.type as SafeDistanceType],
                },
                {
                  label: 'Source description',
                  value: row.sourceDescription ?? '—',
                },
                {
                  label: 'Source voltage',
                  value: formatVoltage(row.sourceVoltageKv),
                },
                {
                  label: 'Operating height',
                  value: formatDistance(row.heightM),
                },
                {
                  label: 'Required distance',
                  value: formatDistance(row.requiredDistanceM),
                },
                {
                  label: 'Actual distance',
                  value: formatDistance(row.actualDistanceM),
                },
                {
                  label: 'Compliance',
                  value: row.complies ? 'Compliant' : 'Non-compliant',
                },
              ]}
            />
          </Section>

          <Section title="People & site">
            <DetailGrid
              rows={[
                { label: 'Site', value: site?.name ?? '—' },
                { label: 'Supervisor', value: supervisor?.name ?? '—' },
                {
                  label: 'Operator',
                  value: operator
                    ? `${operator.lastName ?? ''}${operator.lastName ? ', ' : ''}${operator.firstName ?? ''}`.trim() ||
                      '—'
                    : '—',
                },
                {
                  label: 'Occurred',
                  value: row.occurredAt
                    ? new Date(row.occurredAt).toISOString().slice(0, 16).replace('T', ' ')
                    : '—',
                },
              ]}
            />
          </Section>

          {row.notes ? (
            <Section title="Notes">
              <p className="text-sm whitespace-pre-wrap text-slate-700">{row.notes}</p>
            </Section>
          ) : null}
        </div>
      ) : null}

      {tab === 'edit' && sources ? (
        <form action={updateSafeDistanceRecordForm} className="space-y-5">
          <input type="hidden" name="id" value={row.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sourceDescription">Source description</Label>
              <Input
                id="sourceDescription"
                name="sourceDescription"
                defaultValue={row.sourceDescription ?? ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sourceVoltageKv">Source voltage (kV)</Label>
              <Input
                id="sourceVoltageKv"
                name="sourceVoltageKv"
                type="number"
                step="0.01"
                min="0"
                defaultValue={row.sourceVoltageKv ?? ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="heightM">Operating height (m)</Label>
              <Input
                id="heightM"
                name="heightM"
                type="number"
                step="0.1"
                min="0"
                defaultValue={row.heightM ?? ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="actualDistanceM">Actual distance (m)</Label>
              <Input
                id="actualDistanceM"
                name="actualDistanceM"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={row.actualDistanceM ?? ''}
              />
            </div>
            {row.type === 'other' ? (
              <div className="space-y-2">
                <Label htmlFor="requiredDistanceMOverride">Required distance (m)</Label>
                <Input
                  id="requiredDistanceMOverride"
                  name="requiredDistanceMOverride"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={row.requiredDistanceM ?? ''}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="siteOrgUnitId">Site</Label>
              <Select
                id="siteOrgUnitId"
                name="siteOrgUnitId"
                defaultValue={row.siteOrgUnitId ?? ''}
              >
                <option value="">— No site —</option>
                {sources.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supervisorTenantUserId">Supervisor</Label>
              <PersonSelectField
                name="supervisorTenantUserId"
                defaultValue={row.supervisorTenantUserId ?? ''}
                options={sources.supervisors.map((s) => ({
                  value: s.id,
                  label: s.name ?? '(unnamed)',
                  hint: s.email ?? undefined,
                }))}
                placeholder="Select a supervisor…"
                clearable
                emptyLabel="— None —"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="operatorPersonId">Operator</Label>
              <PersonSelectField
                name="operatorPersonId"
                defaultValue={row.operatorPersonId ?? ''}
                options={sources.operators.map((p) => ({
                  value: p.id,
                  label:
                    `${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() ||
                    '(unnamed)',
                  hint: p.employeeNo ?? undefined,
                }))}
                placeholder="Select an operator…"
                clearable
                emptyLabel="— None —"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} defaultValue={row.notes ?? ''} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <Link href={`/tools/safe-distance/${row.id}`}>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      ) : null}

      {tab === 'activity' ? (
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
