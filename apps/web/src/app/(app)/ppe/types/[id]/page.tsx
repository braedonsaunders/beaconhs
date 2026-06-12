// /ppe/types/[id] — type detail with sub-tabs.
//
// Tabs:
//   general          → name / category / inspectable / cadence / sizing summary
//   inspection-criteria → ordered list of pass/fail criteria, with inline
//                      add / edit / reorder / delete forms
//   sizing-scheme    → jsonb sizing array editor
//
// Each tab is a URL-driven sub-page reachable via ?tab=… so deep-linking
// from /ppe/types just works.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { ArrowDown, ArrowUp, Camera, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { and, asc, count, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
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
import { ppeItems, ppeTypeInspectionCriteria, ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export const dynamic = 'force-dynamic'

const TABS = ['general', 'inspection-criteria', 'sizing-scheme'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `PPE type · ${id.slice(0, 8)}` }
}

// --- Server actions -----------------------------------------------------

async function addCriterion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const ppeTypeId = String(formData.get('ppeTypeId') ?? '').trim()
  const question = String(formData.get('question') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const inspectionKind = String(formData.get('inspectionKind') ?? 'pre_use') as 'pre_use' | 'annual'
  const severity = String(formData.get('severity') ?? 'medium') as
    | 'low'
    | 'medium'
    | 'high'
    | 'critical'
  const requiresPhoto = formData.get('requiresPhoto') === 'on'
  if (!ppeTypeId || !question) return

  const id = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({ c: count() })
      .from(ppeTypeInspectionCriteria)
      .where(
        and(
          eq(ppeTypeInspectionCriteria.ppeTypeId, ppeTypeId),
          eq(ppeTypeInspectionCriteria.inspectionKind, inspectionKind),
        ),
      )
    const entityOrder = Number(maxRow?.c ?? 0) + 1
    const [row] = await tx
      .insert(ppeTypeInspectionCriteria)
      .values({
        tenantId: ctx.tenantId,
        ppeTypeId,
        question,
        description,
        inspectionKind,
        severity,
        requiresPhoto,
        entityOrder,
      })
      .returning({ id: ppeTypeInspectionCriteria.id })
    return row?.id
  })
  if (id) {
    await recordAudit(ctx, {
      entityType: 'ppe_type_inspection_criterion',
      entityId: id,
      action: 'create',
      summary: `Added "${question.slice(0, 60)}" to PPE type criteria`,
      after: { ppeTypeId, inspectionKind, severity, requiresPhoto },
    })
  }
  revalidatePath(`/ppe/types/${ppeTypeId}`)
}

async function updateCriterion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const id = String(formData.get('id') ?? '').trim()
  const ppeTypeId = String(formData.get('ppeTypeId') ?? '').trim()
  const question = String(formData.get('question') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const severity = String(formData.get('severity') ?? 'medium') as
    | 'low'
    | 'medium'
    | 'high'
    | 'critical'
  const requiresPhoto = formData.get('requiresPhoto') === 'on'
  if (!id || !question) return
  await ctx.db((tx) =>
    tx
      .update(ppeTypeInspectionCriteria)
      .set({ question, description, severity, requiresPhoto })
      .where(eq(ppeTypeInspectionCriteria.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_type_inspection_criterion',
    entityId: id,
    action: 'update',
    summary: 'Updated PPE type criterion',
    after: { question, severity, requiresPhoto },
  })
  revalidatePath(`/ppe/types/${ppeTypeId}`)
}

async function deleteCriterion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const id = String(formData.get('id') ?? '').trim()
  const ppeTypeId = String(formData.get('ppeTypeId') ?? '').trim()
  if (!id) return
  await ctx.db((tx) =>
    tx.delete(ppeTypeInspectionCriteria).where(eq(ppeTypeInspectionCriteria.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_type_inspection_criterion',
    entityId: id,
    action: 'delete',
    summary: 'Deleted PPE type criterion',
  })
  revalidatePath(`/ppe/types/${ppeTypeId}`)
}

async function moveCriterion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const id = String(formData.get('id') ?? '').trim()
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down'
  const ppeTypeId = String(formData.get('ppeTypeId') ?? '').trim()
  if (!id || !ppeTypeId || (direction !== 'up' && direction !== 'down')) return
  await ctx.db(async (tx) => {
    const [target] = await tx
      .select()
      .from(ppeTypeInspectionCriteria)
      .where(eq(ppeTypeInspectionCriteria.id, id))
      .limit(1)
    if (!target) return
    const peers = await tx
      .select()
      .from(ppeTypeInspectionCriteria)
      .where(
        and(
          eq(ppeTypeInspectionCriteria.ppeTypeId, ppeTypeId),
          eq(ppeTypeInspectionCriteria.inspectionKind, target.inspectionKind),
        ),
      )
      .orderBy(asc(ppeTypeInspectionCriteria.entityOrder))
    const idx = peers.findIndex((p) => p.id === id)
    if (idx < 0) return
    const swapWith = direction === 'up' ? peers[idx - 1] : peers[idx + 1]
    if (!swapWith) return
    const oldOrder = target.entityOrder
    await tx
      .update(ppeTypeInspectionCriteria)
      .set({ entityOrder: swapWith.entityOrder })
      .where(eq(ppeTypeInspectionCriteria.id, target.id))
    await tx
      .update(ppeTypeInspectionCriteria)
      .set({ entityOrder: oldOrder })
      .where(eq(ppeTypeInspectionCriteria.id, swapWith.id))
  })
  revalidatePath(`/ppe/types/${ppeTypeId}`)
}

async function updateSizing(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const ppeTypeId = String(formData.get('ppeTypeId') ?? '').trim()
  const raw = String(formData.get('sizingScheme') ?? '').trim()
  if (!ppeTypeId) return
  const scheme = raw
    ? raw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : null
  await ctx.db((tx) =>
    tx
      .update(ppeTypes)
      .set({ sizingScheme: scheme && scheme.length > 0 ? scheme : null })
      .where(eq(ppeTypes.id, ppeTypeId)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: ppeTypeId,
    action: 'update',
    summary: 'Updated PPE type sizing scheme',
    after: { sizingScheme: scheme },
  })
  revalidatePath(`/ppe/types/${ppeTypeId}`)
}

// --- Page ---------------------------------------------------------------

export default async function PpeTypeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'general')
  const ctx = await requireModuleManage('ppe')

  const data = await ctx.db(async (tx) => {
    const [t] = await tx.select().from(ppeTypes).where(eq(ppeTypes.id, id)).limit(1)
    if (!t) return null
    const criteria = await tx
      .select()
      .from(ppeTypeInspectionCriteria)
      .where(eq(ppeTypeInspectionCriteria.ppeTypeId, id))
      .orderBy(
        asc(ppeTypeInspectionCriteria.inspectionKind),
        asc(ppeTypeInspectionCriteria.entityOrder),
      )
    const [itemTally] = await tx
      .select({ c: count() })
      .from(ppeItems)
      .where(eq(ppeItems.typeId, id))
    return { type: t, criteria, itemCount: Number(itemTally?.c ?? 0) }
  })
  if (!data) notFound()
  const { type, criteria, itemCount } = data
  const preUseCriteria = criteria.filter((c) => c.inspectionKind === 'pre_use')
  const annualCriteria = criteria.filter((c) => c.inspectionKind === 'annual')

  const basePath = `/ppe/types/${id}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/ppe/types', label: 'Back to PPE types' }}
          title={type.name}
          subtitle={type.category ? `Category: ${type.category}` : 'No category'}
          badge={
            <div className="flex items-center gap-2">
              {type.isInspectable ? (
                <Badge variant="success">Inspectable</Badge>
              ) : (
                <Badge variant="secondary">Not inspectable</Badge>
              )}
              <Badge variant="secondary">
                {itemCount} item{itemCount === 1 ? '' : 's'}
              </Badge>
            </div>
          }
          actions={
            <Link href={`/ppe/types/${id}/edit`}>
              <Button size="sm" variant="outline">
                <Pencil size={12} /> Edit type
              </Button>
            </Link>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'general', label: 'General' },
            {
              key: 'inspection-criteria',
              label: 'Inspection criteria',
              count: criteria.length,
            },
            { key: 'sizing-scheme', label: 'Sizing scheme' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'general' ? (
          <Section title="General">
            <DetailGrid
              rows={[
                { label: 'Name', value: type.name },
                { label: 'Category', value: type.category ?? '—' },
                {
                  label: 'Inspectable',
                  value: type.isInspectable ? 'Yes' : 'No',
                },
                {
                  label: 'Inspection cadence',
                  value: type.inspectionSchedule?.everyDays
                    ? `Every ${type.inspectionSchedule.everyDays} days`
                    : '—',
                },
                {
                  label: 'Sizing scheme',
                  value:
                    type.sizingScheme && type.sizingScheme.length > 0
                      ? type.sizingScheme.join(' · ')
                      : '—',
                },
                { label: 'Items in register', value: itemCount },
                {
                  label: 'Created',
                  value: new Date(type.createdAt).toLocaleDateString(),
                },
                {
                  label: 'Last update',
                  value: new Date(type.updatedAt).toLocaleDateString(),
                },
              ]}
            />
          </Section>
        ) : null}

        {active === 'inspection-criteria' ? (
          <>
            <Section
              title={`Pre-use inspection criteria (${preUseCriteria.length})`}
              subtitle="Questions inspectors complete every day. Reorder with the arrows; a failed high or critical check creates a corrective action."
              defaultOpen
            >
              <CriteriaTable
                ppeTypeId={id}
                kind="pre_use"
                rows={preUseCriteria}
                updateCriterion={updateCriterion}
                deleteCriterion={deleteCriterion}
                moveCriterion={moveCriterion}
              />
            </Section>

            <Section
              title={`Annual inspection criteria (${annualCriteria.length})`}
              subtitle="Used during the annual third-party recertification."
              defaultOpen
            >
              <CriteriaTable
                ppeTypeId={id}
                kind="annual"
                rows={annualCriteria}
                updateCriterion={updateCriterion}
                deleteCriterion={deleteCriterion}
                moveCriterion={moveCriterion}
              />
            </Section>

            <Section title="Add a criterion" defaultOpen>
              <form action={addCriterion} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input type="hidden" name="ppeTypeId" value={id} />
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>Question *</Label>
                  <Input
                    name="question"
                    required
                    placeholder='e.g. "Webbing free of cuts, fraying, or burns?"'
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>Description</Label>
                  <Textarea
                    name="description"
                    rows={2}
                    placeholder="Optional guidance shown to the inspector."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Kind</Label>
                  <Select name="inspectionKind" defaultValue="pre_use">
                    <option value="pre_use">Pre-use</option>
                    <option value="annual">Annual</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Severity on fail</Label>
                  <Select name="severity" defaultValue="medium">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High (creates corrective action)</option>
                    <option value="critical">Critical (creates corrective action)</option>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <input
                    id="requiresPhoto-new"
                    name="requiresPhoto"
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <Label htmlFor="requiresPhoto-new" className="!mb-0">
                    Requires photo
                  </Label>
                </div>
                <div className="flex justify-end sm:col-span-3">
                  <Button type="submit">
                    <Plus size={14} /> Add criterion
                  </Button>
                </div>
              </form>
            </Section>
          </>
        ) : null}

        {active === 'sizing-scheme' ? (
          <Section
            title="Sizing scheme"
            subtitle="Comma- or newline-separated list of valid sizes for items of this type."
            defaultOpen
          >
            <form action={updateSizing} className="space-y-3">
              <input type="hidden" name="ppeTypeId" value={id} />
              <Textarea
                name="sizingScheme"
                rows={4}
                defaultValue={
                  type.sizingScheme && type.sizingScheme.length > 0
                    ? type.sizingScheme.join(', ')
                    : ''
                }
                placeholder="S, M, L, XL"
              />
              <div className="flex justify-end">
                <Button type="submit">Save sizing scheme</Button>
              </div>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              Sizes appear as a dropdown when creating PPE items. Leave blank to allow free-text
              entry.
            </p>
          </Section>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

function CriteriaTable({
  ppeTypeId,
  kind,
  rows,
  updateCriterion,
  deleteCriterion,
  moveCriterion,
}: {
  ppeTypeId: string
  kind: 'pre_use' | 'annual'
  rows: {
    id: string
    question: string
    description: string | null
    severity: 'low' | 'medium' | 'high' | 'critical'
    requiresPhoto: boolean
    entityOrder: number
  }[]
  updateCriterion: (fd: FormData) => Promise<void>
  deleteCriterion: (fd: FormData) => Promise<void>
  moveCriterion: (fd: FormData) => Promise<void>
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={24} />}
        title={`No ${kind === 'pre_use' ? 'pre-use' : 'annual'} criteria`}
        description="Add at least one criterion for inspectors to check."
      />
    )
  }
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Question</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Photo</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.id}>
              <TableCell className="w-12 text-slate-500">{i + 1}</TableCell>
              <TableCell>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-slate-900">
                    {r.question}
                  </summary>
                  <form
                    action={updateCriterion}
                    className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4"
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="ppeTypeId" value={ppeTypeId} />
                    <div className="space-y-1 sm:col-span-4">
                      <Label className="text-xs">Question</Label>
                      <Input name="question" defaultValue={r.question} required />
                    </div>
                    <div className="space-y-1 sm:col-span-4">
                      <Label className="text-xs">Description</Label>
                      <Textarea name="description" rows={2} defaultValue={r.description ?? ''} />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Severity</Label>
                      <Select name="severity" defaultValue={r.severity}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </Select>
                    </div>
                    <div className="flex items-end gap-2 sm:col-span-2">
                      <input
                        id={`req-${r.id}`}
                        type="checkbox"
                        name="requiresPhoto"
                        defaultChecked={r.requiresPhoto}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <Label htmlFor={`req-${r.id}`} className="!mb-0">
                        <Camera size={12} className="inline" /> Requires photo
                      </Label>
                    </div>
                    <div className="flex justify-end sm:col-span-4">
                      <Button type="submit" size="sm">
                        Save
                      </Button>
                    </div>
                  </form>
                </details>
                {r.description ? (
                  <p className="mt-1 text-xs text-slate-500">{r.description}</p>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    r.severity === 'critical' || r.severity === 'high'
                      ? 'destructive'
                      : r.severity === 'medium'
                        ? 'warning'
                        : 'secondary'
                  }
                >
                  {r.severity}
                </Badge>
              </TableCell>
              <TableCell className="text-slate-600">
                {r.requiresPhoto ? <Camera size={14} /> : '—'}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <form action={moveCriterion}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="ppeTypeId" value={ppeTypeId} />
                    <input type="hidden" name="direction" value="up" />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={i === 0}
                      title="Move up"
                    >
                      <ArrowUp size={12} />
                    </Button>
                  </form>
                  <form action={moveCriterion}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="ppeTypeId" value={ppeTypeId} />
                    <input type="hidden" name="direction" value="down" />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={i === rows.length - 1}
                      title="Move down"
                    >
                      <ArrowDown size={12} />
                    </Button>
                  </form>
                  <form action={deleteCriterion}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="ppeTypeId" value={ppeTypeId} />
                    <Button type="submit" size="sm" variant="outline" title="Delete">
                      <Trash2 size={12} />
                    </Button>
                  </form>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
