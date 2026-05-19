import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
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
  UrlDrawer,
} from '@beaconhs/ui'
import { FileText, Lock, Mail, Plus, Trash2, Unlock } from 'lucide-react'
import {
  attachments,
  equipmentItems,
  liftPlanEquipment,
  liftPlanHazards,
  liftPlanLoads,
  liftPlanPhotos,
  liftPlanPpe,
  liftPlanSignatures,
  liftPlans,
  orgUnits,
  people,
  tenantUsers,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { PhotoGallery } from '@/components/photo-gallery'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { CapacityBadge, StatusBadge } from '../_badges'
import {
  LIFT_PLAN_STATUSES,
  formatRole,
  formatStatus,
  type LiftPlanSignatureRole,
} from '../_types'
import {
  addEquipment,
  addHazard,
  addLoad,
  addPpe,
  addSignature,
  attachPhotos,
  changeStatus,
  deleteEquipment,
  deleteHazard,
  deleteLiftPlan,
  deleteLoad,
  deletePhoto,
  deletePpe,
  deleteSignature,
  moveEquipment,
  moveHazard,
  moveLoad,
  movePpe,
  sendLiftPlanEmail,
  toggleLock,
  updateEquipment,
  updateHazard,
  updateLoad,
  updatePhotoCaption,
  updatePpe,
  updateSignature,
} from '../_actions'
import { ResignForm } from '../_signature-form'
import { LiftPlanPhotoUploader } from '../_photo-uploader'
import {
  EquipmentBody,
  EquipmentRow,
  HazardBody,
  HazardRow,
  LoadBody,
  LoadRow,
  PhotoCaptionForm,
  PpeBody,
  PpeRow,
} from './_sections'
import { AddSignatureBody } from './_signature-body'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'loads',
  'equipment',
  'hazards',
  'ppe',
  'signatures',
  'photos',
  'activity',
] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Lift Plan · ${id.slice(0, 8)}` }
}

export default async function LiftPlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active = pickActiveTab(sp, TABS, 'overview')
  const drawer = pickString(sp.drawer)
  const drawerLoadId = pickString(sp.loadId)
  const drawerEquipmentId = pickString(sp.equipmentId)
  const drawerHazardId = pickString(sp.hazardId)
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        plan: liftPlans,
        site: orgUnits,
        supervisor: tenantUsers,
        operator: people,
      })
      .from(liftPlans)
      .leftJoin(orgUnits, eq(orgUnits.id, liftPlans.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, liftPlans.supervisorTenantUserId))
      .leftJoin(people, eq(people.id, liftPlans.operatorPersonId))
      .where(and(eq(liftPlans.id, id), isNull(liftPlans.deletedAt)))
      .limit(1)
    if (!row) return null

    let project: { id: string; name: string } | null = null
    if (row.plan.projectOrgUnitId) {
      const [p] = await tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.id, row.plan.projectOrgUnitId))
        .limit(1)
      project = p ?? null
    }

    let rigger: { id: string; firstName: string; lastName: string } | null = null
    if (row.plan.riggerPersonId) {
      const [r] = await tx
        .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(eq(people.id, row.plan.riggerPersonId))
        .limit(1)
      rigger = r ?? null
    }

    const loads = await tx
      .select()
      .from(liftPlanLoads)
      .where(eq(liftPlanLoads.liftPlanId, id))
      .orderBy(asc(liftPlanLoads.entityOrder))

    const equipment = await tx
      .select({ row: liftPlanEquipment, item: equipmentItems })
      .from(liftPlanEquipment)
      .leftJoin(equipmentItems, eq(equipmentItems.id, liftPlanEquipment.equipmentItemId))
      .where(eq(liftPlanEquipment.liftPlanId, id))
      .orderBy(asc(liftPlanEquipment.entityOrder))

    const hazards = await tx
      .select()
      .from(liftPlanHazards)
      .where(eq(liftPlanHazards.liftPlanId, id))
      .orderBy(asc(liftPlanHazards.entityOrder))

    const ppe = await tx
      .select()
      .from(liftPlanPpe)
      .where(eq(liftPlanPpe.liftPlanId, id))
      .orderBy(asc(liftPlanPpe.entityOrder))

    const signatures = await tx
      .select({ row: liftPlanSignatures, person: people })
      .from(liftPlanSignatures)
      .leftJoin(people, eq(people.id, liftPlanSignatures.personId))
      .where(eq(liftPlanSignatures.liftPlanId, id))
      .orderBy(asc(liftPlanSignatures.createdAt))

    const photos = await tx
      .select({ link: liftPlanPhotos, attachment: attachments })
      .from(liftPlanPhotos)
      .innerJoin(attachments, eq(attachments.id, liftPlanPhotos.attachmentId))
      .where(eq(liftPlanPhotos.liftPlanId, id))

    const workers = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(200)

    const equipmentChoices = await tx
      .select({ id: equipmentItems.id, name: equipmentItems.name, assetTag: equipmentItems.assetTag })
      .from(equipmentItems)
      .where(eq(equipmentItems.status, 'in_service'))
      .orderBy(asc(equipmentItems.name))
      .limit(200)

    return {
      ...row,
      project,
      rigger,
      loads,
      equipment,
      hazards,
      ppe,
      signatures,
      photos,
      workers,
      equipmentChoices,
    }
  })

  if (!data) notFound()
  const {
    plan,
    site,
    supervisor,
    operator,
    project,
    rigger,
    loads,
    equipment,
    hazards,
    ppe,
    signatures,
    photos,
    workers,
    equipmentChoices,
  } = data

  const activity = await recentActivityForEntity(ctx, 'lift_plan', id, 30)
  const galleryPhotos = photos.map((p) => ({
    id: p.link.id,
    url: publicUrl(p.attachment.r2Key),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const basePath = `/lift-plans/${id}`
  const totalWeight = loads.reduce(
    (acc, l) => acc + (l.weightKg ? Number(l.weightKg) : 0),
    0,
  )
  const existingRoles = signatures.map((s) => s.row.role) as LiftPlanSignatureRole[]

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/lift-plans', label: 'Back to lift plans' }}
          title={`Lift Plan ${plan.reference}`}
          subtitle={`Lift date ${new Date(plan.liftDate).toLocaleDateString()} · ${site?.name ?? 'no site'} · ${supervisor?.displayName ?? 'no supervisor'}`}
          badge={
            <div className="flex items-center gap-2">
              <StatusBadge status={plan.status} />
              {plan.locked ? (
                <Badge variant="outline" className="border-amber-300 text-amber-800">
                  <Lock size={10} /> Locked
                </Badge>
              ) : null}
            </div>
          }
          actions={
            <>
              <Link href={`/lift-plans/${id}/edit`}>
                <Button variant="outline" disabled={plan.locked}>
                  Edit
                </Button>
              </Link>
              <Link href={`/lift-plans/${id}/pdf`}>
                <Button variant="outline">
                  <FileText size={14} /> PDF
                </Button>
              </Link>
              <Link
                href={`/lift-plans/${id}?drawer=send-email${active !== 'overview' ? `&tab=${active}` : ''}`}
                scroll={false}
              >
                <Button variant="outline">
                  <Mail size={14} /> Send email
                </Button>
              </Link>
            </>
          }
        />
      }
      alerts={
        <>
          {plan.locked ? (
            <Alert variant="warning">
              <AlertTitle>This lift plan is locked</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>
                  {plan.completedAt
                    ? `Completed on ${new Date(plan.completedAt).toLocaleDateString()}.`
                    : 'Manually locked.'}{' '}
                  Unlock to make edits. <strong>Signatures will be cleared.</strong>
                </span>
                <form action={toggleLock} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="lock" value="false" />
                  <Button variant="outline" size="sm" type="submit">
                    <Unlock size={12} /> Unlock
                  </Button>
                </form>
              </AlertDescription>
            </Alert>
          ) : null}
          {plan.status === 'cancelled' ? (
            <Alert variant="destructive">
              <AlertTitle>Cancelled</AlertTitle>
              <AlertDescription>
                {plan.cancellationReason ?? 'No reason recorded.'}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'loads', label: 'Loads', count: loads.length },
            { key: 'equipment', label: 'Equipment', count: equipment.length },
            { key: 'hazards', label: 'Hazards', count: hazards.length },
            { key: 'ppe', label: 'PPE', count: ppe.length },
            { key: 'signatures', label: 'Signatures', count: signatures.length },
            { key: 'photos', label: 'Photos', count: photos.length },
            { key: 'activity', label: 'Activity', count: activity.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <Section title="General information" subtitle="Where, when, who is involved">
              <DetailGrid
                rows={[
                  {
                    label: 'Reference',
                    value: <span className="font-mono">{plan.reference}</span>,
                  },
                  { label: 'Lift date', value: new Date(plan.liftDate).toLocaleDateString() },
                  { label: 'Project', value: project?.name ?? '—' },
                  { label: 'Site', value: site?.name ?? '—' },
                  { label: 'Supervisor', value: supervisor?.displayName ?? '—' },
                  {
                    label: 'Crane operator',
                    value: operator ? `${operator.firstName} ${operator.lastName}` : '—',
                  },
                  {
                    label: 'Rigger',
                    value: rigger ? `${rigger.firstName} ${rigger.lastName}` : '—',
                  },
                  { label: 'Status', value: <StatusBadge status={plan.status} /> },
                  {
                    label: 'Total load weight',
                    value: totalWeight > 0 ? `${totalWeight.toFixed(2)} kg` : '—',
                  },
                  {
                    label: 'Created',
                    value: new Date(plan.createdAt).toLocaleString(),
                  },
                ]}
              />
              {plan.description ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/40 p-3 text-sm">
                  <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                    Description / scope
                  </div>
                  <p className="whitespace-pre-wrap text-slate-900">{plan.description}</p>
                </div>
              ) : null}
            </Section>

            <Card>
              <CardHeader>
                <CardTitle>Status workflow</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={changeStatus} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={id} />
                  <div className="space-y-1.5">
                    <Label>Move to</Label>
                    <Select name="status" defaultValue={plan.status}>
                      {LIFT_PLAN_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {formatStatus(s)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>If cancelling, why?</Label>
                    <Input
                      name="cancellationReason"
                      placeholder="Reason (optional unless cancelling)"
                      className="w-72"
                    />
                  </div>
                  <Button type="submit">Update status</Button>
                </form>
                <p className="mt-3 text-xs text-slate-500">
                  Completing a plan auto-locks it. Unlocking clears all signatures so they have to
                  be re-collected.
                </p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {plan.locked ? <Lock size={14} /> : <Unlock size={14} />}
                    Lock state
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {plan.locked ? (
                    <p className="text-sm text-slate-600">
                      Locked
                      {plan.lockedAt
                        ? ` on ${new Date(plan.lockedAt).toLocaleString()}`
                        : ''}
                      . Children can't be edited until unlocked.
                    </p>
                  ) : (
                    <p className="text-sm text-slate-600">
                      Unlocked. Anyone with edit permission can change the loads, equipment,
                      hazards, PPE, signatures, and photos.
                    </p>
                  )}
                  <form action={toggleLock}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="lock" value={plan.locked ? 'false' : 'true'} />
                    <Button variant={plan.locked ? 'outline' : 'secondary'} size="sm" type="submit">
                      {plan.locked ? (
                        <>
                          <Unlock size={12} /> Unlock plan
                        </>
                      ) : (
                        <>
                          <Lock size={12} /> Lock plan
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail size={14} />
                    Send to recipients
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={sendLiftPlanEmail} className="space-y-2">
                    <input type="hidden" name="id" value={id} />
                    <Label className="text-xs">Recipient emails (comma or space-separated)</Label>
                    <Input name="recipients" placeholder="supervisor@…, operator@…" />
                    <Button type="submit" size="sm">
                      Queue email
                    </Button>
                    <p className="text-[11px] text-slate-500">
                      Logged to the activity feed; the email worker delivers asynchronously.
                    </p>
                  </form>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-700">
                  <Trash2 size={14} /> Delete
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={deleteLiftPlan}>
                  <input type="hidden" name="id" value={id} />
                  <p className="mb-2 text-sm text-slate-600">
                    Soft-deletes the lift plan. Reference number stays reserved.
                  </p>
                  <Button variant="destructive" size="sm" type="submit">
                    Delete lift plan
                  </Button>
                </form>
              </CardContent>
            </Card>
          </>
        ) : null}

        {active === 'loads' ? (
          <Section title={`Loads (${loads.length})`}>
            <div className="space-y-1">
              <div className="hidden grid-cols-6 gap-2 border-b border-slate-200 pb-1.5 text-xs uppercase tracking-wide text-slate-500 sm:grid">
                <div className="sm:col-span-2">Description</div>
                <div>Weight (kg)</div>
                <div>Max dim (mm)</div>
                <div>Attachment</div>
                <div className="text-right">Actions</div>
              </div>
              {loads.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">No loads added yet.</p>
              ) : (
                loads.map((l) => (
                  <LoadRow
                    key={l.id}
                    load={{
                      id: l.id,
                      description: l.description,
                      weightKg: l.weightKg,
                      dimensionsMaxMm: l.dimensionsMaxMm,
                      attachmentMethod: l.attachmentMethod,
                    }}
                    liftPlanId={id}
                    locked={plan.locked}
                    deleteAction={deleteLoad}
                    moveAction={moveLoad}
                  />
                ))
              )}
              {totalWeight > 0 ? (
                <p className="pt-2 text-xs text-slate-500">
                  Sum of all load weights: <strong>{totalWeight.toFixed(2)} kg</strong>. Drives the
                  capacity-used % auto-calc on every equipment row.
                </p>
              ) : null}
              {!plan.locked ? (
                <div className="pt-3">
                  <Link href={`/lift-plans/${id}?tab=loads&drawer=add-load`}>
                    <Button variant="outline" size="sm">
                      <Plus size={12} /> Add load
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {active === 'equipment' ? (
          <Section title={`Equipment (${equipment.length})`}>
            <div className="space-y-1">
              <div className="hidden grid-cols-7 gap-2 border-b border-slate-200 pb-1.5 text-xs uppercase tracking-wide text-slate-500 sm:grid">
                <div className="sm:col-span-2">Item</div>
                <div>Capacity (kg)</div>
                <div>Boom (m)</div>
                <div>Radius (m)</div>
                <div>Used %</div>
                <div className="text-right">Actions</div>
              </div>
              {equipment.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">No equipment added yet.</p>
              ) : (
                equipment.map(({ row, item }) => (
                  <div key={row.id} className="space-y-1">
                    <EquipmentRow
                      row={{
                        id: row.id,
                        equipmentItemId: row.equipmentItemId,
                        equipmentDescription: row.equipmentDescription,
                        capacityKg: row.capacityKg,
                        boomLengthM: row.boomLengthM,
                        radiusM: row.radiusM,
                        capacityUsedPct: row.capacityUsedPct,
                        itemName: item?.name ?? null,
                      }}
                      liftPlanId={id}
                      locked={plan.locked}
                      deleteAction={deleteEquipment}
                      moveAction={moveEquipment}
                    />
                    {row.capacityUsedPct ? (
                      <div className="px-1 text-[11px] text-slate-500">
                        <CapacityBadge pct={Number(row.capacityUsedPct)} /> based on {totalWeight.toFixed(2)}{' '}
                        kg total load / {row.capacityKg ?? '—'} kg capacity.
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              {!plan.locked ? (
                <div className="pt-3">
                  <Link href={`/lift-plans/${id}?tab=equipment&drawer=add-equipment`}>
                    <Button variant="outline" size="sm">
                      <Plus size={12} /> Add equipment
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {active === 'hazards' ? (
          <Section title={`Hazards (${hazards.length})`}>
            <div className="space-y-1">
              <div className="hidden grid-cols-5 gap-2 border-b border-slate-200 pb-1.5 text-xs uppercase tracking-wide text-slate-500 sm:grid">
                <div className="sm:col-span-2">Hazard</div>
                <div className="sm:col-span-2">Controls</div>
                <div className="text-right">Actions</div>
              </div>
              {hazards.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">No hazards listed yet.</p>
              ) : (
                hazards.map((h) => (
                  <HazardRow
                    key={h.id}
                    row={{
                      id: h.id,
                      hazardDescription: h.hazardDescription,
                      controls: h.controls,
                    }}
                    liftPlanId={id}
                    locked={plan.locked}
                    deleteAction={deleteHazard}
                    moveAction={moveHazard}
                  />
                ))
              )}
              {!plan.locked ? (
                <div className="pt-3">
                  <Link href={`/lift-plans/${id}?tab=hazards&drawer=add-hazard`}>
                    <Button variant="outline" size="sm">
                      <Plus size={12} /> Add hazard
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {active === 'ppe' ? (
          <Section title={`Required PPE (${ppe.length})`}>
            <div className="space-y-1">
              <div className="hidden grid-cols-4 gap-2 border-b border-slate-200 pb-1.5 text-xs uppercase tracking-wide text-slate-500 sm:grid">
                <div className="sm:col-span-2">PPE</div>
                <div>Status</div>
                <div className="text-right">Actions</div>
              </div>
              {ppe.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">No PPE listed yet.</p>
              ) : (
                ppe.map((p) => (
                  <PpeRow
                    key={p.id}
                    row={{ id: p.id, ppeName: p.ppeName, required: p.required }}
                    liftPlanId={id}
                    locked={plan.locked}
                    deleteAction={deletePpe}
                    moveAction={movePpe}
                  />
                ))
              )}
              {!plan.locked ? (
                <div className="pt-3">
                  <Link href={`/lift-plans/${id}?tab=ppe&drawer=add-ppe`}>
                    <Button variant="outline" size="sm">
                      <Plus size={12} /> Add PPE
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {active === 'signatures' ? (
          <Section title={`Signatures (${signatures.length})`} defaultOpen>
            <div className="space-y-3">
              {signatures.length === 0 ? (
                <p className="text-sm text-slate-500">No signatures captured yet.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {signatures.map((s) => (
                    <div
                      key={s.row.id}
                      className="rounded-md border border-slate-200 bg-white p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            {formatRole(s.row.role)}
                          </div>
                          <div className="text-sm font-medium">
                            {s.person
                              ? `${s.person.firstName} ${s.person.lastName}`
                              : (s.row.externalName ?? '—')}
                          </div>
                        </div>
                        {!plan.locked ? (
                          <form action={deleteSignature}>
                            <input type="hidden" name="id" value={s.row.id} />
                            <input type="hidden" name="liftPlanId" value={id} />
                            <Button variant="ghost" size="sm" type="submit">
                              <Trash2 size={12} className="text-red-500" />
                            </Button>
                          </form>
                        ) : null}
                      </div>
                      {s.row.signatureDataUrl ? (
                        <img
                          src={s.row.signatureDataUrl}
                          alt={`${formatRole(s.row.role)} signature`}
                          className="mt-2 h-20 w-full rounded border border-slate-100 bg-white object-contain"
                        />
                      ) : (
                        <div className="mt-2 rounded border border-dashed border-red-200 bg-red-50/40 p-2 text-xs text-red-700">
                          Not signed yet
                        </div>
                      )}
                      {s.row.signedAt ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Signed {new Date(s.row.signedAt).toLocaleString()}
                        </div>
                      ) : !plan.locked ? (
                        <div className="mt-2">
                          <ResignForm
                            signatureId={s.row.id}
                            liftPlanId={id}
                            updateAction={updateSignature}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {!plan.locked ? (
                <Link href={`/lift-plans/${id}?tab=signatures&drawer=add-signature`}>
                  <Button variant="outline" size="sm">
                    <Plus size={12} /> Add signature
                  </Button>
                </Link>
              ) : (
                <p className="text-xs text-slate-500">Unlock the plan to add signatures.</p>
              )}
            </div>
          </Section>
        ) : null}

        {active === 'photos' ? (
          <Section title={`Photos (${photos.length})`} defaultOpen>
            <div className="space-y-3">
              <PhotoGallery photos={galleryPhotos} />
              {photos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
                  {photos.map((p) => (
                    <div key={p.link.id} className="rounded border border-slate-200 bg-white p-1">
                      <PhotoCaptionForm
                        photoId={p.link.id}
                        liftPlanId={id}
                        caption={p.link.caption}
                        locked={plan.locked}
                        updateAction={updatePhotoCaption}
                        deleteAction={deletePhoto}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {!plan.locked ? (
                <LiftPlanPhotoUploader liftPlanId={id} attachAction={attachPhotos} />
              ) : null}
            </div>
          </Section>
        ) : null}

        {active === 'activity' ? (
          <Section title={`Activity (${activity.length})`} defaultOpen>
            <ActivityFeed entries={activity} />
          </Section>
        ) : null}
      </div>

      <UrlDrawer
        open={drawer === 'add-load'}
        closeHref={`/lift-plans/${id}?tab=loads`}
        title="Add load"
        size="md"
        footer={
          <>
            <Link href={`/lift-plans/${id}?tab=loads`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-load-form">
              <Plus size={14} /> Add
            </Button>
          </>
        }
      >
        <LoadBody
          formId="lp-load-form"
          liftPlanId={id}
          action={addLoad}
          closeHref={`/lift-plans/${id}?tab=loads`}
        />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'edit-load' && Boolean(drawerLoadId)}
        closeHref={`/lift-plans/${id}?tab=loads`}
        title="Edit load"
        size="md"
        footer={
          <>
            <Link href={`/lift-plans/${id}?tab=loads`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-load-form">
              Save
            </Button>
          </>
        }
      >
        {(() => {
          const load = loads.find((l) => l.id === drawerLoadId)
          if (!load) return <p className="text-sm text-slate-500">Load not found.</p>
          return (
            <LoadBody
              formId="lp-load-form"
              liftPlanId={id}
              load={{
                id: load.id,
                description: load.description,
                weightKg: load.weightKg,
                dimensionsMaxMm: load.dimensionsMaxMm,
                attachmentMethod: load.attachmentMethod,
              }}
              action={updateLoad}
              closeHref={`/lift-plans/${id}?tab=loads`}
            />
          )
        })()}
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'add-equipment'}
        closeHref={`/lift-plans/${id}?tab=equipment`}
        title="Add equipment"
        size="md"
        footer={
          <>
            <Link href={`/lift-plans/${id}?tab=equipment`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-equipment-form">
              <Plus size={14} /> Add
            </Button>
          </>
        }
      >
        <EquipmentBody
          formId="lp-equipment-form"
          liftPlanId={id}
          equipmentItems={equipmentChoices}
          action={addEquipment}
          closeHref={`/lift-plans/${id}?tab=equipment`}
        />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'edit-equipment' && Boolean(drawerEquipmentId)}
        closeHref={`/lift-plans/${id}?tab=equipment`}
        title="Edit equipment"
        size="md"
        footer={
          <>
            <Link href={`/lift-plans/${id}?tab=equipment`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-equipment-form">
              Save
            </Button>
          </>
        }
      >
        {(() => {
          const eq = equipment.find((e) => e.row.id === drawerEquipmentId)
          if (!eq) return <p className="text-sm text-slate-500">Equipment not found.</p>
          return (
            <EquipmentBody
              formId="lp-equipment-form"
              liftPlanId={id}
              row={{
                id: eq.row.id,
                equipmentItemId: eq.row.equipmentItemId,
                equipmentDescription: eq.row.equipmentDescription,
                capacityKg: eq.row.capacityKg,
                boomLengthM: eq.row.boomLengthM,
                radiusM: eq.row.radiusM,
                capacityUsedPct: eq.row.capacityUsedPct,
                itemName: eq.item?.name ?? null,
              }}
              equipmentItems={equipmentChoices}
              action={updateEquipment}
              closeHref={`/lift-plans/${id}?tab=equipment`}
            />
          )
        })()}
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'add-hazard'}
        closeHref={`/lift-plans/${id}?tab=hazards`}
        title="Add hazard"
        size="md"
        footer={
          <>
            <Link href={`/lift-plans/${id}?tab=hazards`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-hazard-form">
              <Plus size={14} /> Add
            </Button>
          </>
        }
      >
        <HazardBody
          formId="lp-hazard-form"
          liftPlanId={id}
          action={addHazard}
          closeHref={`/lift-plans/${id}?tab=hazards`}
        />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'edit-hazard' && Boolean(drawerHazardId)}
        closeHref={`/lift-plans/${id}?tab=hazards`}
        title="Edit hazard"
        size="md"
        footer={
          <>
            <Link href={`/lift-plans/${id}?tab=hazards`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-hazard-form">
              Save
            </Button>
          </>
        }
      >
        {(() => {
          const h = hazards.find((x) => x.id === drawerHazardId)
          if (!h) return <p className="text-sm text-slate-500">Hazard not found.</p>
          return (
            <HazardBody
              formId="lp-hazard-form"
              liftPlanId={id}
              row={{
                id: h.id,
                hazardDescription: h.hazardDescription,
                controls: h.controls,
              }}
              action={updateHazard}
              closeHref={`/lift-plans/${id}?tab=hazards`}
            />
          )
        })()}
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'add-ppe'}
        closeHref={`/lift-plans/${id}?tab=ppe`}
        title="Add PPE"
        size="sm"
        footer={
          <>
            <Link href={`/lift-plans/${id}?tab=ppe`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-ppe-form">
              <Plus size={14} /> Add
            </Button>
          </>
        }
      >
        <PpeBody
          formId="lp-ppe-form"
          liftPlanId={id}
          action={addPpe}
          closeHref={`/lift-plans/${id}?tab=ppe`}
        />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'add-signature'}
        closeHref={`/lift-plans/${id}?tab=signatures`}
        title="Add signature"
        description="Capture a signed-off role for this lift plan."
        size="md"
        footer={
          <>
            <Link href={`/lift-plans/${id}?tab=signatures`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-signature-form">
              Add signature
            </Button>
          </>
        }
      >
        <AddSignatureBody
          formId="lp-signature-form"
          liftPlanId={id}
          people={workers}
          existingRoles={existingRoles}
          action={addSignature}
          closeHref={`/lift-plans/${id}?tab=signatures`}
        />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'send-email'}
        closeHref={`/lift-plans/${id}${active !== 'overview' ? `?tab=${active}` : ''}`}
        title={`Send lift plan · ${plan.reference}`}
        description="Sends a structured lift plan recap to the tenant admin distribution list by default, or to the explicit recipients below."
        size="md"
        footer={
          <>
            <Link
              href={`/lift-plans/${id}${active !== 'overview' ? `?tab=${active}` : ''}`}
            >
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="lp-send-email-form">
              Send email
            </Button>
          </>
        }
      >
        <form
          id="lp-send-email-form"
          action={async (fd) => {
            'use server'
            fd.set('id', id)
            await sendLiftPlanEmail(fd)
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="lp-se-recipients">Recipients (comma-separated)</Label>
            <Input
              id="lp-se-recipients"
              name="recipients"
              type="text"
              placeholder="alice@example.com, bob@example.com"
            />
            <p className="text-[11px] text-slate-500">
              Each address gets its own copy. Leave blank to send to the default tenant
              admin distribution list.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-se-cc">Cc</Label>
            <Input id="lp-se-cc" name="cc" type="text" placeholder="cc@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-se-subject">Subject prefix</Label>
            <Input
              id="lp-se-subject"
              name="subjectPrefix"
              defaultValue="Update"
              placeholder="Update / Action required / FYI"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-se-message">Personal note (optional)</Label>
            <Input
              id="lp-se-message"
              name="message"
              placeholder="Add context for the recipients."
            />
          </div>
        </form>
      </UrlDrawer>
    </DetailPageLayout>
  )
}
