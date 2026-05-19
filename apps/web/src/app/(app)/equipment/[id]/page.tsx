import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import {
  Activity,
  ArrowLeftRight,
  ClipboardCheck,
  FileText,
  MapPin,
  QrCode,
  Truck,
  Wrench,
} from 'lucide-react'
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
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import {
  attachments,
  equipmentItems,
  equipmentLocationHistory,
  equipmentTypes,
  equipmentWorkOrders,
  formResponses,
  formTemplates,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ActivityFeed } from '@/components/activity-feed'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'maintenance',
  'work_orders',
  'location',
  'certificates',
  'inspections',
  'activity',
] as const
type Tab = (typeof TABS)[number]

// ---------------- Server actions ----------------

async function reportMissing(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx
      .update(equipmentItems)
      .set({ isMissing: true, lastSeenAt: new Date() })
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
    tx.update(equipmentItems).set({ isMissing: false }).where(eq(equipmentItems.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: 'Reported found',
  })
  revalidatePath(`/equipment/${id}`)
}

async function transferLocation(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const holderPersonId = String(formData.get('holderPersonId') ?? '').trim() || null
  const note = String(formData.get('note') ?? '').trim() || null
  if (!siteOrgUnitId && !holderPersonId) return

  await ctx.db(async (tx) => {
    await tx
      .update(equipmentItems)
      .set({
        currentSiteOrgUnitId: siteOrgUnitId,
        currentHolderPersonId: holderPersonId,
        lastSeenSiteOrgUnitId: siteOrgUnitId,
        lastSeenHolderPersonId: holderPersonId,
        lastSeenAt: new Date(),
        isMissing: false,
      })
      .where(eq(equipmentItems.id, id))
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId: id,
      siteOrgUnitId,
      holderPersonId,
      recordedByTenantUserId: ctx.membership?.id,
      note,
    })
  })
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: 'Equipment transferred',
    after: { siteOrgUnitId, holderPersonId, note },
  })
  revalidatePath(`/equipment/${id}`)
}

async function createWorkOrder(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '')
  const summary = String(formData.get('summary') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const status =
    (String(formData.get('status') ?? 'open') as
      | 'open'
      | 'assigned'
      | 'in_progress'
      | 'awaiting_parts'
      | 'repaired'
      | 'verified'
      | 'closed'
      | 'cancelled')
  if (!itemId || !summary) return

  const ref = await ctx.db(async (tx) => {
    const [agg] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(equipmentWorkOrders)
    const next = ((agg?.n ?? 0) + 1).toString().padStart(4, '0')
    const reference = `WO-${new Date().getFullYear()}-${next}`
    await tx.insert(equipmentWorkOrders).values({
      tenantId: ctx.tenantId,
      itemId,
      reference,
      status,
      summary,
      description,
      openedByTenantUserId: ctx.membership?.id,
    })
    return reference
  })
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: itemId,
    action: 'create',
    summary: `Opened work order ${ref}`,
    after: { reference: ref, summary, status },
  })
  revalidatePath(`/equipment/${itemId}`)
}

// ---------------- Page ----------------

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
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

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

    const [history, workOrders, sites, holders, certAttachments, inspectionResponses] =
      await Promise.all([
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
        tx.select().from(orgUnits).orderBy(asc(orgUnits.name)).limit(200),
        tx.select().from(people).orderBy(asc(people.lastName), asc(people.firstName)).limit(200),
        // "Certificates" — document-kind attachments linked to this equipment via metadata->>equipmentId
        tx
          .select()
          .from(attachments)
          .where(
            and(
              eq(attachments.kind, 'document'),
              sql`${attachments.exif}->>'equipmentId' = ${id}`,
            ),
          )
          .orderBy(desc(attachments.createdAt))
          .limit(50),
        tx
          .select({ response: formResponses, template: formTemplates })
          .from(formResponses)
          .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
          .where(
            and(
              eq(formResponses.sourceEntityType, 'equipment'),
              eq(formResponses.sourceEntityId, id),
            ),
          )
          .orderBy(desc(formResponses.submittedAt))
          .limit(50),
      ])

    return { ...row, history, workOrders, sites, holders, certAttachments, inspectionResponses }
  })

  if (!data) notFound()
  const {
    item,
    type,
    site,
    holder,
    history,
    workOrders,
    sites,
    holders,
    certAttachments,
    inspectionResponses,
  } = data

  const openWOs = workOrders.filter((w) => !['closed', 'cancelled'].includes(w.status))
  const basePath = `/equipment/${id}`

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'equipment', id, 50) : []

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
              Last seen {item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : '—'}. Use
              Transfer below to update the location when found.
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
                { key: 'overview', label: 'Overview' },
                { key: 'maintenance', label: 'Maintenance' },
                { key: 'work_orders', label: 'Work orders', count: openWOs.length },
                { key: 'location', label: 'Location', count: history.length },
                { key: 'certificates', label: 'Certificates', count: certAttachments.length },
                {
                  key: 'inspections',
                  label: 'Inspections',
                  count: inspectionResponses.length,
                },
                { key: 'activity', label: 'Activity' },
              ]}
            />

            {active === 'overview' ? (
              <Section title="General">
                <DetailGrid
                  rows={[
                    { label: 'Name', value: item.name },
                    { label: 'Asset tag', value: <span className="font-mono">{item.assetTag}</span> },
                    { label: 'Serial #', value: item.serialNumber ?? '—' },
                    { label: 'Type', value: type?.name ?? '—' },
                    { label: 'Category', value: type?.category ?? '—' },
                    { label: 'Description', value: item.description ?? '—' },
                    { label: 'Current site', value: site?.name ?? '—' },
                    {
                      label: 'Current holder',
                      value: holder ? (
                        <Link href={`/people/${holder.id}`} className="text-teal-700 hover:underline">
                          {holder.firstName} {holder.lastName}
                        </Link>
                      ) : (
                        '—'
                      ),
                    },
                    { label: 'Purchased', value: item.purchaseDate ?? '—' },
                    { label: 'Warranty expires', value: item.warrantyExpiresOn ?? '—' },
                    { label: 'Billing category', value: item.billingRateCategory ?? '—' },
                    {
                      label: 'Last seen',
                      value: item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : '—',
                    },
                  ]}
                />
              </Section>
            ) : null}

            {active === 'maintenance' ? (
              <div className="space-y-4">
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
                          label: 'Pre-use template',
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
                <Section title="Start a new inspection">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <p className="text-slate-600">
                      Choose a form template bound to equipment inspection to start a new
                      inspection. The completed form will appear under the Inspections tab.
                    </p>
                    <Link
                      href={`/forms?category=inspection&sourceEntityType=equipment&sourceEntityId=${id}`}
                    >
                      <Button>
                        <ClipboardCheck size={14} /> Browse inspection forms
                      </Button>
                    </Link>
                  </div>
                </Section>
              </div>
            ) : null}

            {active === 'work_orders' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Work orders ({workOrders.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {workOrders.length === 0 ? (
                      <EmptyState
                        icon={<Wrench size={24} />}
                        title="No work orders"
                        description="Open a work order below to track repairs or scheduled service."
                      />
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
                                <Badge
                                  variant={
                                    w.status === 'closed'
                                      ? 'success'
                                      : w.status === 'cancelled'
                                        ? 'secondary'
                                        : 'warning'
                                  }
                                >
                                  {w.status.replace('_', ' ')}
                                </Badge>
                              </TableCell>
                              <TableCell>{new Date(w.openedAt).toLocaleDateString()}</TableCell>
                              <TableCell>
                                {w.closedAt ? new Date(w.closedAt).toLocaleDateString() : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
                <Section title="Open a new work order">
                  <form
                    action={createWorkOrder}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    <input type="hidden" name="itemId" value={id} />
                    <Field label="Summary" required className="sm:col-span-2">
                      <Input name="summary" required placeholder="e.g. Brake lights inoperative" />
                    </Field>
                    <Field label="Initial status">
                      <Select name="status" defaultValue="open">
                        <option value="open">Open</option>
                        <option value="assigned">Assigned</option>
                        <option value="in_progress">In progress</option>
                        <option value="awaiting_parts">Awaiting parts</option>
                      </Select>
                    </Field>
                    <Field label="Description" className="sm:col-span-2">
                      <Textarea name="description" rows={3} placeholder="What's wrong?" />
                    </Field>
                    <div className="sm:col-span-2 flex justify-end">
                      <Button type="submit">
                        <Wrench size={14} /> Create work order
                      </Button>
                    </div>
                  </form>
                </Section>
              </div>
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
                        <Link
                          href={`/people/${holder.id}`}
                          className="text-teal-700 hover:underline"
                        >
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
                      <p className="text-sm text-slate-500">No movement recorded yet.</p>
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
                                {row.holder
                                  ? `${row.holder.firstName} ${row.holder.lastName}`
                                  : '—'}
                              </TableCell>
                              <TableCell className="text-slate-600">
                                {row.history.note ?? '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
                <Section title="Transfer to a new location or holder">
                  <form
                    action={transferLocation}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    <input type="hidden" name="id" value={id} />
                    <Field label="Move to site">
                      <Select name="siteOrgUnitId" defaultValue={item.currentSiteOrgUnitId ?? ''}>
                        <option value="">— Unassigned —</option>
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Assign to person">
                      <Select
                        name="holderPersonId"
                        defaultValue={item.currentHolderPersonId ?? ''}
                      >
                        <option value="">— No holder —</option>
                        {holders.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.lastName}, {p.firstName}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Note" className="sm:col-span-2">
                      <Input name="note" placeholder="Optional context for the audit log" />
                    </Field>
                    <div className="sm:col-span-2 flex justify-end">
                      <Button type="submit">
                        <ArrowLeftRight size={14} /> Record transfer
                      </Button>
                    </div>
                  </form>
                </Section>
              </div>
            ) : null}

            {active === 'certificates' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Certificates ({certAttachments.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {certAttachments.length === 0 ? (
                    <EmptyState
                      icon={<FileText size={24} />}
                      title="No certificates attached"
                      description="Upload calibration, inspection, or warranty certificates and tag them with this equipment's id in their exif metadata to surface them here."
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>File</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead>Uploaded</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {certAttachments.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="font-medium">{a.filename}</TableCell>
                            <TableCell className="text-slate-600">{a.contentType}</TableCell>
                            <TableCell className="text-slate-600">
                              {humanSize(a.sizeBytes)}
                            </TableCell>
                            <TableCell>
                              {new Date(a.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <a
                                href={publicUrl(a.r2Key)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-teal-700 hover:underline"
                              >
                                Open →
                              </a>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {active === 'inspections' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Inspection history ({inspectionResponses.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {inspectionResponses.length === 0 ? (
                    <EmptyState
                      icon={<ClipboardCheck size={24} />}
                      title="No inspections recorded"
                      description="Pre-use, scheduled, and ad-hoc inspections (any form pinned to this equipment) appear here."
                      action={
                        <Link
                          href={`/forms?category=inspection&sourceEntityType=equipment&sourceEntityId=${id}`}
                        >
                          <Button variant="outline" size="sm">
                            Start an inspection →
                          </Button>
                        </Link>
                      }
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Form</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Submitted</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inspectionResponses.map((r) => (
                          <TableRow key={r.response.id}>
                            <TableCell className="font-medium">{r.template.name}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  r.response.status === 'closed' ||
                                  r.response.status === 'submitted'
                                    ? 'success'
                                    : 'warning'
                                }
                              >
                                {r.response.status.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {r.response.submittedAt
                                ? new Date(r.response.submittedAt).toLocaleDateString()
                                : '—'}
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/forms/responses/${r.response.id}`}
                                className="text-xs text-teal-700 hover:underline"
                              >
                                View →
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {active === 'activity' ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Activity size={14} className="mr-2 inline" /> Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityFeed entries={activity} />
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

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
