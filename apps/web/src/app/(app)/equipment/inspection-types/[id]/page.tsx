import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { ArrowDown, ArrowUp, ListChecks, Trash2 } from 'lucide-react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
      after: { inspectionTypeId, question, kind, severity, requiresPhoto, isCritical },
    })
  }
  revalidatePath(`/equipment/inspection-types/${inspectionTypeId}`)
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
                description="Add your first question below. Order the list with the up/down arrows."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Question</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Flags</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criteria.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-slate-500">{c.sequence}</TableCell>
                        <TableCell>
                          <div className="font-medium">{c.question}</div>
                          {c.description ? (
                            <div className="text-xs text-slate-500">{c.description}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{c.kind.replace('_', ' ')}</Badge>
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="space-x-1">
                          {c.requiresPhoto ? (
                            <Badge variant="secondary">photo</Badge>
                          ) : null}
                          {c.requiresComment ? (
                            <Badge variant="secondary">comment</Badge>
                          ) : null}
                          {c.isCritical ? (
                            <Badge variant="destructive">critical</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <form action={moveCriterion}>
                              <input type="hidden" name="id" value={c.id} />
                              <input
                                type="hidden"
                                name="inspectionTypeId"
                                value={t.id}
                              />
                              <input type="hidden" name="dir" value="up" />
                              <Button type="submit" size="sm" variant="outline">
                                <ArrowUp size={12} />
                              </Button>
                            </form>
                            <form action={moveCriterion}>
                              <input type="hidden" name="id" value={c.id} />
                              <input
                                type="hidden"
                                name="inspectionTypeId"
                                value={t.id}
                              />
                              <input type="hidden" name="dir" value="down" />
                              <Button type="submit" size="sm" variant="outline">
                                <ArrowDown size={12} />
                              </Button>
                            </form>
                            <form action={deleteCriterion}>
                              <input type="hidden" name="id" value={c.id} />
                              <input
                                type="hidden"
                                name="inspectionTypeId"
                                value={t.id}
                              />
                              <Button type="submit" size="sm" variant="outline">
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
