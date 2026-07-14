import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
} from '@beaconhs/ui'
import { safeDistanceRecords, safeDistanceSegments } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity } from '@/lib/audit'
import { isUuid, pickString } from '@/lib/list-params'
import { canUseSafeDistance } from '@/lib/safe-distance-access'
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
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const tab = pickActiveTab<Tab>(sp, TABS, 'calculator')
  const mutationError = pickString(sp.error)?.slice(0, 300) ?? null
  const ctx = await requireRequestContext()
  if (!canUseSafeDistance(ctx)) notFound()

  const detail = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(safeDistanceRecords)
      .where(and(eq(safeDistanceRecords.id, id), isNull(safeDistanceRecords.deletedAt)))
      .limit(1)
    if (!row) return null
    const segments = await tx
      .select()
      .from(safeDistanceSegments)
      .where(eq(safeDistanceSegments.recordId, id))
      .orderBy(asc(safeDistanceSegments.sortOrder))
    return { row, segments }
  })

  if (!detail) notFound()
  const { row, segments } = detail

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
            <input type="hidden" name="version" value={row.updatedAt.toISOString()} />
            <input type="hidden" name="desired" value={row.locked ? 'false' : 'true'} />
            <Button variant="outline" type="submit">
              {row.locked ? 'Unlock' : 'Lock'}
            </Button>
          </form>
          {row.locked ? null : (
            <form action={deleteSafeDistanceRecordAndRedirect}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="version" value={row.updatedAt.toISOString()} />
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
      {mutationError ? (
        <Alert variant="destructive">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      ) : null}
      {tab === 'calculator' ? (
        <SafeDistanceEditor
          record={{
            id: row.id,
            version: row.updatedAt.toISOString(),
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
        />
      ) : null}

      {tab === 'activity' ? (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
          </CardContent>
        </Card>
      ) : null}
    </DetailPageLayout>
  )
}
