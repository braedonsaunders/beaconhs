import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DetailHeader } from '@beaconhs/ui'
import {
  orgUnits,
  people,
  safeDistanceRecords,
  safeDistanceSegments,
  tenantUsers,
  user as userTable,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { deleteSafeDistanceRecordAndRedirect, toggleLockSafeDistanceRecord } from '../_actions'
import {
  SAFE_DISTANCE_METHOD_LABELS,
  type SafeDistanceMethod,
  type SafeDistanceSegmentUnit,
  type SafeDistanceUnit,
} from '../_lib'
import { SafeDistanceEditor } from './_editor'

export const dynamic = 'force-dynamic'

const TABS = ['calculator', 'activity'] as const
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
  const tab = pickActiveTab<Tab>(sp, TABS, 'calculator')
  const ctx = await requireRequestContext()

  const detail = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(safeDistanceRecords)
      .where(eq(safeDistanceRecords.id, id))
      .limit(1)
    if (!row) return null
    const segments = await tx
      .select()
      .from(safeDistanceSegments)
      .where(eq(safeDistanceSegments.recordId, id))
      .orderBy(asc(safeDistanceSegments.sortOrder))
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
      .limit(500)
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
    return { row, segments, sites, supervisors, operators }
  })

  if (!detail) notFound()
  const { row, segments, sites, supervisors, operators } = detail

  const activity =
    tab === 'activity'
      ? await recentActivityForEntity(ctx, 'safe_distance_record', row.id, 100)
      : []

  const lockedBadge = row.locked ? (
    <Badge variant="secondary">Locked</Badge>
  ) : (
    <Badge variant="outline">Unlocked</Badge>
  )

  const header = (
    <DetailHeader
      back={{ href: '/tools/safe-distance', label: 'All assessments' }}
      title={row.reference}
      subtitle={`${row.name} — ${SAFE_DISTANCE_METHOD_LABELS[row.method as SafeDistanceMethod]}`}
      badge={lockedBadge}
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

  const subtabs = (
    <TabNav
      basePath={`/tools/safe-distance/${row.id}`}
      currentParams={sp}
      tabs={[
        { key: 'calculator', label: 'Calculator' },
        { key: 'activity', label: 'Activity' },
      ]}
      active={tab}
    />
  )

  return (
    <DetailPageLayout header={header} subtabs={subtabs}>
      {tab === 'calculator' ? (
        <SafeDistanceEditor
          record={{
            id: row.id,
            name: row.name,
            method: row.method as SafeDistanceMethod,
            unit: row.unit as SafeDistanceUnit,
            testPressure: row.testPressure,
            description: row.description,
            notes: row.notes,
            siteOrgUnitId: row.siteOrgUnitId,
            supervisorTenantUserId: row.supervisorTenantUserId,
            operatorPersonId: row.operatorPersonId,
            locked: row.locked,
          }}
          initialSegments={segments.map((s) => ({
            name: s.name,
            unit: s.unit as SafeDistanceSegmentUnit,
            lengthValue: s.lengthValue,
            internalDiameter: s.internalDiameter,
          }))}
          sites={sites}
          supervisors={supervisors.map((s) => ({
            value: s.id,
            label: s.name ?? '(unnamed)',
            hint: s.email ?? undefined,
          }))}
          operators={operators.map((p) => ({
            value: p.id,
            label:
              `${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() ||
              '(unnamed)',
            hint: p.employeeNo ?? undefined,
          }))}
        />
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
