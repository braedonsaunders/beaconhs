import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { ArrowDown, ArrowUp, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  equipmentInspectionCriteria,
  equipmentInspectionTypes,
  equipmentTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { Section } from '@/components/section'

export const dynamic = 'force-dynamic'

const KIND_OPTIONS = [
  { value: 'pass_fail', label: 'Pass / Fail' },
  { value: 'pass_fail_na', label: 'Pass / Fail / N/A' },
  { value: 'text', label: 'Text answer' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'photo', label: 'Photo required' },
]
const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Inspection type · ${id.slice(0, 8)}` }
}

async function updateTemplate(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const interval = String(formData.get('interval') ?? 'on_demand').trim()
  const appliesToTypeId = String(formData.get('appliesToTypeId') ?? '').trim() || null
  const allowPassAll = formData.get('allowPassAll') === 'on'
  const failsSpawnWorkOrders = formData.get('failsSpawnWorkOrders') === 'on'
  if (!id || !name) return
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionTypes)
      .set({
        name,
        description,
        interval: interval as any,
        appliesToTypeId,
        allowPassAll,
        failsSpawnWorkOrders,
      })
      .where(eq(equipmentInspectionTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_type',
    entityId: id,
    action: 'update',
    summary: `Updated inspection type "${name}"`,
    after: { name, description, interval, appliesToTypeId, allowPassAll, failsSpawnWorkOrders },
  })
  revalidatePath(`/equipment/inspection-types/${id}`)
  revalidatePath('/equipment/inspection-types')
}

async function addCriterion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const inspectionTypeId = String(formData.get('inspectionTypeId') ?? '').trim()
  const question = String(formData.get('question') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const kind = String(formData.get('kind') ?? 'pass_fail').trim() || 'pass_fail'
  const severity = String(formData.get('severity') ?? 'medium').trim() || 'medium'
  const requiresPhoto = formData.get('requiresPhoto') === 'on'
  const requiresComment = formData.get('requiresComment') === 'on'
  // `isRequired` defaults true; the checkbox is wired as "Optional" and we
  // invert here so unchecked = required (the common case).
  const isRequired = formData.get('isOptional') !== 'on'
  const isCritical = formData.get('isCritical') === 'on'
  if (!inspectionTypeId || !question) return

  const inserted = await ctx.db(async (tx) => {
    const [last] = await tx
      .select({ s: sql<number>`COALESCE(MAX(${equipmentInspectionCriteria.sequence}), 0)::int` })
      .from(equipmentInspectionCriteria)
      .where(eq(equipmentInspectionCriteria.inspectionTypeId, inspectionTypeId))
    const nextSeq = (last?.s ?? 0) + 1
    const [row] = await tx
      .insert(equipmentInspectionCriteria)
      .values({
        tenantId: ctx.tenantId,
        inspectionTypeId,
        sequence: nextSeq,
        question,
        description,
        kind: kind as any,
        severity: severity as any,
        requiresPhoto,
        requiresComment,
        isRequired,
        isCritical,
      })
      .returning({ id: equipmentInspectionCriteria.id })
    return row
  })
  if (inserted?.id) {
    await recordAudit(ctx, {
      entityType: 'equipment_inspection_criterion',
      entityId: inserted.id,
      action: 'create',
      summary: 'Added inspection criterion',
      after: {
        inspectionTypeId,
        question,
        kind,
        severity,
        requiresPhoto,
        requiresComment,
        isRequired,
        isCritical,
      },
    })
  }
  revalidatePath(`/equipment/inspection-types/${inspectionTypeId}`)
}

async function updateCriterion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  const inspectionTypeId = String(formData.get('inspectionTypeId') ?? '').trim()
  const question = String(formData.get('question') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const kind = String(formData.get('kind') ?? 'pass_fail').trim() || 'pass_fail'
  const severity = String(formData.get('severity') ?? 'medium').trim() || 'medium'
  const requiresPhoto = formData.get('requiresPhoto') === 'on'
  const requiresComment = formData.get('requiresComment') === 'on'
  const isRequired = formData.get('isRequired') === 'on'
  const isCritical = formData.get('isCritical') === 'on'
  if (!id || !question) return

  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionCriteria)
      .set({
        question,
        description,
        kind: kind as any,
        severity: severity as any,
        requiresPhoto,
        requiresComment,
        isRequired,
        isCritical,
      })
      .where(eq(equipmentInspectionCriteria.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_criterion',
    entityId: id,
    action: 'update',
    summary: 'Updated inspection criterion',
    after: { question, kind, severity, requiresPhoto, requiresComment, isRequired, isCritical },
  })
  if (inspectionTypeId) revalidatePath(`/equipment/inspection-types/${inspectionTypeId}`)
}

async function moveCriterion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  const dir = String(formData.get('dir') ?? '').trim() // 'up' | 'down'
  if (!id || !dir) return
  await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(equipmentInspectionCriteria)
      .where(eq(equipmentInspectionCriteria.id, id))
      .limit(1)
    if (!row) return
    const order = dir === 'up' ? 'desc' : 'asc'
    const neighbours = await tx
      .select()
      .from(equipmentInspectionCriteria)
      .where(eq(equipmentInspectionCriteria.inspectionTypeId, row.inspectionTypeId))
      .orderBy(equipmentInspectionCriteria.sequence)
    const sorted = neighbours.slice()
    const idx = sorted.findIndex((c) => c.id === row.id)
    const swapWith = dir === 'up' ? sorted[idx - 1] : sorted[idx + 1]
    if (!swapWith) return
    // Two-phase swap to dodge a unique-index collision if we ever add one.
    await tx
      .update(equipmentInspectionCriteria)
      .set({ sequence: swapWith.sequence })
      .where(eq(equipmentInspectionCriteria.id, row.id))
    await tx
      .update(equipmentInspectionCriteria)
      .set({ sequence: row.sequence })
      .where(eq(equipmentInspectionCriteria.id, swapWith.id))
  })
  revalidatePath(`/equipment/inspection-types/${formData.get('inspectionTypeId')}`)
}

async function deleteCriterion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  const inspectionTypeId = String(formData.get('inspectionTypeId') ?? '').trim()
  if (!id) return
  await ctx.db((tx) =>
    tx.delete(equipmentInspectionCriteria).where(eq(equipmentInspectionCriteria.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_criterion',
    entityId: id,
    action: 'delete',
    summary: 'Deleted inspection criterion',
  })
  if (inspectionTypeId) revalidatePath(`/equipment/inspection-types/${inspectionTypeId}`)
}

export default async function InspectionTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        t: equipmentInspectionTypes,
        applies: equipmentTypes,
      })
      .from(equipmentInspectionTypes)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentInspectionTypes.appliesToTypeId))
      .where(eq(equipmentInspectionTypes.id, id))
      .limit(1)
    if (!row) return null
    const criteria = await tx
      .select()
      .from(equipmentInspectionCriteria)
      .where(eq(equipmentInspectionCriteria.inspectionTypeId, id))
      .orderBy(asc(equipmentInspectionCriteria.sequence))
    const allTypes = await tx
      .select({ id: equipmentTypes.id, name: equipmentTypes.name })
      .from(equipmentTypes)
      .orderBy(asc(equipmentTypes.name))
    return { ...row, criteria, allTypes }
  })
  if (!data) notFound()
  const { t, applies, criteria, allTypes } = data

  const INTERVAL_OPTIONS = [
    { value: 'pre_use', label: 'Pre-use' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'annually', label: 'Annually' },
    { value: 'five_year', label: 'Every 5 years' },
    { value: 'on_demand', label: 'On demand' },
  ]

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title={t.name}
          description={t.description ?? 'Inspection template'}
          back={{ href: '/equipment/inspection-types', label: 'Back to inspection types' }}
          actions={
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{t.interval.replace('_', ' ')}</Badge>
              {applies ? <Badge variant="secondary">{applies.name}</Badge> : null}
              {t.failsSpawnWorkOrders ? <Badge variant="warning">Fails → WO</Badge> : null}
              {t.allowPassAll ? <Badge variant="success">Pass-all</Badge> : null}
            </div>
          }
        />

        <Section title="Settings" defaultOpen={false}>
          <form action={updateTemplate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={t.id} />
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name *</Label>
              <Input name="name" defaultValue={t.name} required />
            </div>
            <div className="space-y-1.5">
              <Label>Applies to type</Label>
              <Select name="appliesToTypeId" defaultValue={t.appliesToTypeId ?? ''}>
                <option value="">— Any —</option>
                {allTypes.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Interval</Label>
              <Select name="interval" defaultValue={t.interval}>
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea name="description" rows={2} defaultValue={t.description ?? ''} />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="allowPassAll"
                  defaultChecked={t.allowPassAll}
                />
                <span>Allow "pass all" shortcut</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="failsSpawnWorkOrders"
                  defaultChecked={t.failsSpawnWorkOrders}
                />
                <span>Failed criterion auto-creates a work order</span>
              </label>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit">Save settings</Button>
            </div>
          </form>
        </Section>

        <Card>
          <CardHeader>
            <CardTitle>
              <ListChecks size={14} className="mr-2 inline" /> Criteria ({criteria.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {criteria.length === 0 ? (
              <EmptyState
                title="No criteria yet"
                description="Add your first question below. Reorder with the up/down arrows; click the pencil to edit a criterion in place."
              />
            ) : (
              <ul className="space-y-2">
                {criteria.map((c, idx) => (
                  <li
                    key={c.id}
                    className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                  >
                    <details className="group">
                      <summary className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                          {c.sequence}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900">
                            {c.question}
                          </div>
                          {c.description ? (
                            <div className="truncate text-xs text-slate-500">
                              {c.description}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          <Badge variant="secondary">{c.kind.replace('_', ' ')}</Badge>
                          <Badge
                            variant={
                              c.severity === 'critical' || c.severity === 'high'
                                ? 'destructive'
                                : c.severity === 'medium'
                                  ? 'warning'
                                  : 'secondary'
                            }
                          >
                            {c.severity}
                          </Badge>
                          {c.isRequired ? null : (
                            <Badge variant="secondary">optional</Badge>
                          )}
                          {c.isCritical ? <Badge variant="destructive">critical</Badge> : null}
                          {c.requiresPhoto ? (
                            <Badge variant="secondary">photo</Badge>
                          ) : null}
                          {c.requiresComment ? (
                            <Badge variant="secondary">comment</Badge>
                          ) : null}
                        </div>
                        <div className="ml-2 flex shrink-0 items-center gap-1">
                          <form action={moveCriterion}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="inspectionTypeId" value={t.id} />
                            <input type="hidden" name="dir" value="up" />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              disabled={idx === 0}
                              aria-label="Move up"
                            >
                              <ArrowUp size={12} />
                            </Button>
                          </form>
                          <form action={moveCriterion}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="inspectionTypeId" value={t.id} />
                            <input type="hidden" name="dir" value="down" />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              disabled={idx === criteria.length - 1}
                              aria-label="Move down"
                            >
                              <ArrowDown size={12} />
                            </Button>
                          </form>
                          <span
                            aria-label="Edit"
                            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors group-open:bg-teal-50 group-open:text-teal-700"
                          >
                            <Pencil size={12} />
                          </span>
                          <form action={deleteCriterion}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="inspectionTypeId" value={t.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              aria-label="Delete"
                            >
                              <Trash2 size={12} />
                            </Button>
                          </form>
                        </div>
                      </summary>
                      <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
                        <form
                          action={updateCriterion}
                          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                        >
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="inspectionTypeId" value={t.id} />
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label>Question *</Label>
                            <Input name="question" defaultValue={c.question} required />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Kind</Label>
                            <Select name="kind" defaultValue={c.kind}>
                              {KIND_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Severity</Label>
                            <Select name="severity" defaultValue={c.severity}>
                              {SEVERITY_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label>Help text</Label>
                            <Textarea
                              name="description"
                              rows={2}
                              defaultValue={c.description ?? ''}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-2">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                name="isRequired"
                                defaultChecked={c.isRequired}
                              />
                              <span>Required</span>
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                name="requiresPhoto"
                                defaultChecked={c.requiresPhoto}
                              />
                              <span>Photo required</span>
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                name="requiresComment"
                                defaultChecked={c.requiresComment}
                              />
                              <span>Comment required</span>
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                name="isCritical"
                                defaultChecked={c.isCritical}
                              />
                              <span>Critical (fail forces WO + red flag)</span>
                            </label>
                          </div>
                          <div className="flex justify-end sm:col-span-2">
                            <Button type="submit" size="sm">
                              Save changes
                            </Button>
                          </div>
                        </form>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Section title="Add a criterion" defaultOpen>
          <form action={addCriterion} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="inspectionTypeId" value={t.id} />
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Question *</Label>
              <Input
                name="question"
                required
                placeholder='e.g. "Are the brake lights working?"'
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select name="kind" defaultValue="pass_fail">
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select name="severity" defaultValue="medium">
                {SEVERITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Help text</Label>
              <Textarea name="description" rows={2} placeholder="Optional guidance" />
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="isOptional" />
                <span>Optional answer (default: required)</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="requiresPhoto" />
                <span>Photo required</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="requiresComment" />
                <span>Comment required</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="isCritical" />
                <span>Critical (fail forces WO + red flag)</span>
              </label>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit">Add criterion</Button>
            </div>
          </form>
        </Section>
      </div>
    </PageContainer>
  )
}
