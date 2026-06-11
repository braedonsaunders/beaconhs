// Fleet summary report — high-level overview of the whole equipment register.
// Aggregates status / type counts, top sites by current asset count, and an
// "items needing attention" rollup (open work orders, missing items, overdue
// annual inspections). The detailed per-asset table lives at /assets to keep
// this page glanceable.

import Link from 'next/link'
import { AlertTriangle, MapPin, Search, Truck, Wrench } from 'lucide-react'
import { and, asc, count, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { Badge, Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { equipmentItems, equipmentTypes, equipmentWorkOrders, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { AnimatedBar } from '@/app/(app)/dashboard/_bar'

export const metadata = { title: 'Fleet report' }
export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  in_service: 'In service',
  out_of_service: 'Out of service',
  in_repair: 'In repair',
  lost: 'Lost',
  retired: 'Retired',
}

const STATUS_TONES: Record<string, 'teal' | 'amber' | 'rose'> = {
  in_service: 'teal',
  out_of_service: 'amber',
  in_repair: 'amber',
  lost: 'rose',
  retired: 'amber',
}

type SummaryBucket = { key: string; label: string; count: number }

export default async function FleetReport() {
  const ctx = await requireRequestContext()
  const todayIso = new Date().toISOString().slice(0, 10)

  const {
    statusBuckets,
    typeBuckets,
    topSites,
    totalItems,
    missingCount,
    overdueInspections,
    openWorkOrders,
    needsAttention,
  } = await ctx.db(async (tx) => {
    // ---- Status counts: in_service / out_of_service / in_repair / retired
    // ---- plus a synthetic "missing" bucket pulled from is_missing.
    const statusRows = await tx
      .select({ status: equipmentItems.status, c: count() })
      .from(equipmentItems)
      .where(isNull(equipmentItems.deletedAt))
      .groupBy(equipmentItems.status)
    const statusCountsMap = Object.fromEntries(
      statusRows.map((r) => [r.status, Number(r.c)] as const),
    )
    const [missingAgg] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .where(and(isNull(equipmentItems.deletedAt), eq(equipmentItems.isMissing, true)))
    const missingCount = Number(missingAgg?.c ?? 0)

    const labelOf = (k: string) => STATUS_LABELS[k] ?? k
    const statusBuckets: SummaryBucket[] = [
      { key: 'in_service', label: labelOf('in_service'), count: statusCountsMap.in_service ?? 0 },
      { key: 'in_repair', label: labelOf('in_repair'), count: statusCountsMap.in_repair ?? 0 },
      {
        key: 'out_of_service',
        label: labelOf('out_of_service'),
        count: statusCountsMap.out_of_service ?? 0,
      },
      { key: 'retired', label: labelOf('retired'), count: statusCountsMap.retired ?? 0 },
      { key: 'missing', label: 'Missing', count: missingCount },
    ]
    const totalItems = statusRows.reduce((s, r) => s + Number(r.c), 0)

    // ---- Type counts: join through equipment_types so the type name is the
    // ---- visible label. "(no type)" catches items without a typeId.
    const typeRows = await tx
      .select({
        typeId: equipmentItems.typeId,
        typeName: equipmentTypes.name,
        c: count(),
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .where(isNull(equipmentItems.deletedAt))
      .groupBy(equipmentItems.typeId, equipmentTypes.name)
      .orderBy(desc(count()))
      .limit(10)
    const typeBuckets: SummaryBucket[] = typeRows.map((r) => ({
      key: r.typeId ?? 'no-type',
      label: r.typeName ?? '(no type)',
      count: Number(r.c),
    }))

    // ---- Top sites by current item count. Uses the current_site_org_unit_id
    // ---- on the item (faster than walking location_history and matches the
    // ---- list page's "current site" column).
    const siteRows = await tx
      .select({
        siteId: equipmentItems.currentSiteOrgUnitId,
        siteName: orgUnits.name,
        c: count(),
      })
      .from(equipmentItems)
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .where(and(isNull(equipmentItems.deletedAt), isNotNull(equipmentItems.currentSiteOrgUnitId)))
      .groupBy(equipmentItems.currentSiteOrgUnitId, orgUnits.name)
      .orderBy(desc(count()))
      .limit(5)
    const topSites: SummaryBucket[] = siteRows.map((r) => ({
      key: r.siteId ?? 'unassigned',
      label: r.siteName ?? '(unassigned)',
      count: Number(r.c),
    }))

    // ---- Needs-attention bucket: any item with (a) open work orders,
    // ---- (b) annual inspection past due, or (c) reported missing.
    const [openWoAgg] = await tx
      .select({ c: count() })
      .from(equipmentWorkOrders)
      .where(sql`${equipmentWorkOrders.status} NOT IN ('closed', 'cancelled')`)
    const openWorkOrders = Number(openWoAgg?.c ?? 0)

    const [overdueAgg] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .where(
        and(
          isNull(equipmentItems.deletedAt),
          isNotNull(equipmentItems.nextAnnualInspectionDue),
          lt(equipmentItems.nextAnnualInspectionDue, todayIso),
        ),
      )
    const overdueInspections = Number(overdueAgg?.c ?? 0)

    // Top 10 attention items — show overdue inspections + missing + items
    // with the most open work orders, joined together for the right rail.
    const attentionItems = await tx
      .select({
        id: equipmentItems.id,
        assetTag: equipmentItems.assetTag,
        name: equipmentItems.name,
        siteName: orgUnits.name,
        nextAnnualInspectionDue: equipmentItems.nextAnnualInspectionDue,
        isMissing: equipmentItems.isMissing,
        openWoCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${equipmentWorkOrders}
          WHERE ${equipmentWorkOrders.itemId} = ${equipmentItems.id}
            AND ${equipmentWorkOrders.status} NOT IN ('closed', 'cancelled')
        )`,
      })
      .from(equipmentItems)
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .where(
        and(
          isNull(equipmentItems.deletedAt),
          sql`(
            ${equipmentItems.isMissing} = true
            OR (
              ${equipmentItems.nextAnnualInspectionDue} IS NOT NULL
              AND ${equipmentItems.nextAnnualInspectionDue} < ${todayIso}
            )
            OR EXISTS (
              SELECT 1 FROM ${equipmentWorkOrders}
              WHERE ${equipmentWorkOrders.itemId} = ${equipmentItems.id}
                AND ${equipmentWorkOrders.status} NOT IN ('closed', 'cancelled')
            )
          )`,
        ),
      )
      .orderBy(desc(equipmentItems.isMissing), asc(equipmentItems.nextAnnualInspectionDue))
      .limit(10)

    return {
      statusBuckets,
      typeBuckets,
      topSites,
      totalItems,
      missingCount,
      overdueInspections,
      openWorkOrders,
      needsAttention: attentionItems.map((row) => ({
        ...row,
        openWoCount: Number(row.openWoCount ?? 0),
      })),
    }
  })

  const statusMax = Math.max(1, ...statusBuckets.map((b) => b.count))
  const typeMax = Math.max(1, ...typeBuckets.map((b) => b.count))
  const sitesMax = Math.max(1, ...topSites.map((b) => b.count))

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="reports" />
          <PageHeader
            title="Fleet report"
            description="High-level overview of the equipment register: status, types, top sites, and items needing attention."
            back={{ href: '/equipment/reports', label: 'Back to reports' }}
            actions={
              <div className="flex items-center gap-2">
                <Link href="/equipment/reports/fleet/assets">
                  <Button variant="outline">
                    <Search size={14} />
                    All assets
                  </Button>
                </Link>
                <Link href={buildExportHref('/equipment/reports/fleet/export.csv', {})}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
              </div>
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge variant="secondary">{totalItems} total</Badge>
            <Badge variant="warning">{openWorkOrders} open work orders</Badge>
            <Badge variant={overdueInspections > 0 ? 'destructive' : 'secondary'}>
              {overdueInspections} inspections overdue
            </Badge>
            <Badge variant={missingCount > 0 ? 'destructive' : 'secondary'}>
              {missingCount} missing
            </Badge>
          </div>
        </>
      }
    >
      {totalItems === 0 ? (
        <EmptyState
          icon={<Truck size={32} />}
          title="No equipment in register"
          description="Add equipment to populate the fleet report."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="By status"
            icon={Truck}
            caption={`${totalItems} assets across ${statusBuckets.filter((b) => b.count > 0).length} buckets`}
          >
            <BarList buckets={statusBuckets} max={statusMax} tone="status" />
          </Card>
          <Card title="By type" icon={Wrench} caption="Top 10">
            {typeBuckets.length === 0 ? (
              <Empty>No types yet.</Empty>
            ) : (
              <BarList buckets={typeBuckets} max={typeMax} />
            )}
          </Card>
          <Card title="Top sites" icon={MapPin} caption="Most assets currently at this location">
            {topSites.length === 0 ? (
              <Empty>No assets are pinned to a site yet.</Empty>
            ) : (
              <BarList buckets={topSites} max={sitesMax} />
            )}
          </Card>
          <Card
            title="Needs attention"
            icon={AlertTriangle}
            caption={`${needsAttention.length} item${needsAttention.length === 1 ? '' : 's'}`}
          >
            {needsAttention.length === 0 ? (
              <Empty>Nothing flagged. Quiet on the front.</Empty>
            ) : (
              <ul className="space-y-1.5 px-4 pt-1 pb-3">
                {needsAttention.map((item) => {
                  const reasons: {
                    label: string
                    tone: 'destructive' | 'warning' | 'secondary'
                  }[] = []
                  if (item.isMissing) reasons.push({ label: 'missing', tone: 'destructive' })
                  if (
                    item.nextAnnualInspectionDue !== null &&
                    item.nextAnnualInspectionDue < todayIso
                  )
                    reasons.push({ label: 'inspection overdue', tone: 'warning' })
                  if (item.openWoCount > 0)
                    reasons.push({
                      label: `${item.openWoCount} open WO${item.openWoCount === 1 ? '' : 's'}`,
                      tone: 'warning',
                    })
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/equipment/${item.id}`}
                          className="block truncate text-sm font-medium text-slate-900 hover:text-teal-700"
                        >
                          <span className="font-mono text-xs text-slate-500">{item.assetTag}</span>{' '}
                          <span>— {item.name}</span>
                        </Link>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500">
                          {item.siteName ?? 'Unassigned site'}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {reasons.map((r) => (
                          <Badge key={r.label} variant={r.tone}>
                            {r.label}
                          </Badge>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </ListPageLayout>
  )
}

// =====================================================================
// Card primitives — small wrappers matching the dashboard widget look.
// =====================================================================

function Card({
  title,
  caption,
  icon: Icon,
  children,
}: {
  title: string
  caption?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 ring-1 ring-slate-200 ring-inset">
          <Icon size={14} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3>
          {caption ? <p className="truncate text-[11px] text-slate-500">{caption}</p> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function BarList({
  buckets,
  max,
  tone,
}: {
  buckets: SummaryBucket[]
  max: number
  tone?: 'status'
}) {
  return (
    <ul className="space-y-2.5 px-4 py-3">
      {buckets.map((b, idx) => {
        const pct = (b.count / max) * 100
        const barTone =
          tone === 'status'
            ? (STATUS_TONES[b.key] ?? 'teal')
            : pct > 75
              ? 'rose'
              : pct > 40
                ? 'amber'
                : 'teal'
        return (
          <li key={b.key}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-slate-700">{b.label}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 tabular-nums">
                {b.count}
              </span>
            </div>
            <div className="mt-1.5">
              <AnimatedBar pct={pct} delay={0.06 + idx * 0.04} tone={barTone} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-3 py-8 text-center text-xs text-slate-500">
      {children}
    </div>
  )
}
