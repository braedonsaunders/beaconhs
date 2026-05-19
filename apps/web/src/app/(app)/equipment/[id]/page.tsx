import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { ArrowLeftRight, MapPin, QrCode, Truck, Wrench } from 'lucide-react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  equipmentItems,
  equipmentLocationHistory,
  equipmentTypes,
  equipmentWorkOrders,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

const TABS = ['maintenance', 'work_orders', 'location', 'edit'] as const
type Tab = (typeof TABS)[number]

async function reportMissing(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx
      .update(equipmentItems)
      .set({
        isMissing: true,
        lastSeenAt: new Date(),
      })
      .where(eq(equipmentItems.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: 'Reported missing',
  })
  revalidatePath(`/equipment/${id}`)
}

async function reportFound(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx
      .update(equipmentItems)
      .set({ isMissing: false })
      .where(eq(equipmentItems.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: 'Reported found',
  })
  revalidatePath(`/equipment/${id}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Equipment · ${id.slice(0, 8)}` }
}

export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'maintenance')

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .where(eq(equipmentItems.id, id))
      .limit(1)
    if (!row) return null

    const [history, workOrders] = await Promise.all([
      tx
        .select({ history: equipmentLocationHistory, site: orgUnits, holder: people })
        .from(equipmentLocationHistory)
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentLocationHistory.siteOrgUnitId))
        .leftJoin(people, eq(people.id, equipmentLocationHistory.holderPersonId))
        .where(eq(equipmentLocationHistory.itemId, id))
        .orderBy(desc(equipmentLocationHistory.recordedAt))
        .limit(50),
      tx
        .select()
        .from(equipmentWorkOrders)
        .where(eq(equipmentWorkOrders.itemId, id))
        .orderBy(desc(equipmentWorkOrders.openedAt))
        .limit(50),
    ])

    return { ...row, history, workOrders }
  })

  if (!data) notFound()
  const { item, type, site, holder, history, workOrders } = data

  const openWOs = workOrders.filter((w) => !['closed', 'cancelled'].includes(w.status))
  const basePath = `/equipment/${id}`

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/equipment', label: 'Back to equipment' }}
          title={item.name}
          subtitle={`${item.assetTag}${item.serialNumber ? ` · ${item.serialNumber}` : ''}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={item.status === 'in_service' ? 'success' : 'warning'}>
                {item.status.replace('_', ' ')}
              </Badge>
              {item.isMissing ? <Badge variant="destructive">Missing</Badge> : null}
            </div>
          }
          actions={
            <>
              <Link href={`/equipment/${id}/qr`}>
                <Button variant="outline">
                  <QrCode size={14} />
                  QR
                </Button>
              </Link>
              {item.isMissing ? (
                <form action={reportFound}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline">
                    Report found
                  </Button>
                </form>
              ) : (
                <form action={reportMissing}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline">
                    Report missing
                  </Button>
                </form>
              )}
            </>
          }
        />

        {item.isMissing ? (
          <Alert variant="destructive">
            <AlertTitle>Reported missing</AlertTitle>
            <AlertDescription>
              Last seen {item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : '—'}. Update
              the location tab when found.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-3">
            <Card>
              <CardContent className="space-y-3 p-5 text-sm">
                <div className="flex h-32 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                  <Truck size={48} />
                </div>
                <div className="text-center">
                  <div className="text-base font-semibold">{item.name}</div>
                  <div className="text-xs text-slate-500">{type?.name ?? '—'}</div>
                </div>
                <div className="space-y-1.5 border-t border-slate-100 pt-3">
                  <SidebarRow label="Asset tag">{item.assetTag}</SidebarRow>
                  <SidebarRow label="Serial #">{item.serialNumber ?? '—'}</SidebarRow>
                  <SidebarRow label="Category">{type?.category ?? '—'}</SidebarRow>
                  <SidebarRow label="Site">{site?.name ?? '—'}</SidebarRow>
                  <SidebarRow label="Holder">
                    {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                  </SidebarRow>
                  <SidebarRow label="Billing">{item.billingRateCategory ?? '—'}</SidebarRow>
                  <SidebarRow label="Purchased">{item.purchaseDate ?? '—'}</SidebarRow>
                  <SidebarRow label="Warranty">{item.warrantyExpiresOn ?? '—'}</SidebarRow>
                </div>
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-4">
            <TabNav
              basePath={basePath}
              currentParams={sp}
              active={active}
              tabs={[
                { key: 'maintenance', label: 'Maintenance' },
                { key: 'work_orders', label: 'Work Orders', count: openWOs.length },
                { key: 'location', label: 'Location', count: history.length },
                { key: 'edit', label: 'Edit' },
              ]}
            />

            {active === 'maintenance' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Inspection settings</CardTitle>
                </CardHeader>
                <CardContent>
                  <DetailGrid
                    rows={[
                      {
                        label: 'Requires pre-use inspection',
                        value: item.requiresPreUseInspection ? (
                          <Badge variant="success">Yes</Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
                        ),
                      },
                      {
                        label: 'Pre-use inspection template',
                        value: item.preUseInspectionTemplateKey ?? '—',
                      },
                      {
                        label: 'Last pre-use inspection',
                        value: item.lastPreUseInspectionAt
                          ? new Date(item.lastPreUseInspectionAt).toLocaleString()
                          : '—',
                      },
                      {
                        label: 'Requires annual inspection',
                        value: item.requiresAnnualInspection ? (
                          <Badge variant="success">Yes</Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
                        ),
                      },
                      { label: 'Last annual', value: item.lastAnnualInspectionOn ?? '—' },
                      { label: 'Next annual due', value: item.nextAnnualInspectionDue ?? '—' },
                    ]}
                  />
                </CardContent>
              </Card>
            ) : null}

            {active === 'work_orders' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Work orders ({workOrders.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {workOrders.length === 0 ? (
                    <EmptyState icon={<Wrench size={24} />} title="No work orders" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ref</TableHead>
                          <TableHead>Summary</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Opened</TableHead>
                          <TableHead>Closed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {workOrders.map((w) => (
                          <TableRow key={w.id}>
                            <TableCell className="font-mono text-xs">{w.reference}</TableCell>
                            <TableCell>{w.summary}</TableCell>
                            <TableCell>
                              <Badge variant={w.status === 'closed' ? 'success' : 'warning'}>
                                {w.status.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell>{new Date(w.openedAt).toLocaleDateString()}</TableCell>
                            <TableCell>{w.closedAt ? new Date(w.closedAt).toLocaleDateString() : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {active === 'location' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Current location</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <MapPin size={16} className="text-slate-400" />
                      {site?.name ?? 'Unassigned'}
                    </div>
                    {holder ? (
                      <div className="text-slate-600">
                        Held by{' '}
                        <Link href={`/people/${holder.id}`} className="text-teal-700 hover:underline">
                          {holder.firstName} {holder.lastName}
                        </Link>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Location history ({history.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {history.length === 0 ? (
                      <p className="text-sm text-slate-500">No movement recorded.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>When</TableHead>
                            <TableHead>Site</TableHead>
                            <TableHead>Holder</TableHead>
                            <TableHead>Note</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {history.map((row) => (
                            <TableRow key={row.history.id}>
                              <TableCell>
                                {new Date(row.history.recordedAt).toLocaleString()}
                              </TableCell>
                              <TableCell>{row.site?.name ?? '—'}</TableCell>
                              <TableCell>
                                {row.holder ? `${row.holder.firstName} ${row.holder.lastName}` : '—'}
                              </TableCell>
                              <TableCell className="text-slate-600">{row.history.note ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {active === 'edit' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Edit equipment</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-500">
                    Edit form lands in the next pass — schema already supports all fields shown in
                    the sidebar.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span>{children}</span>
    </div>
  )
}
