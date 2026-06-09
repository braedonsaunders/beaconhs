import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, gt, lt, sql } from 'drizzle-orm'
import { ArrowDown, ArrowUp, ClipboardList, Pencil, Trash2 } from 'lucide-react'
import {
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
} from '@beaconhs/ui'
import { inspectionBankCriteria, inspectionBanks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailPageLayout } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ActivityFeed } from '@/components/activity-feed'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'criteria', 'activity'] as const
type Tab = (typeof TABS)[number]

const RESPONSE_TYPES = [
  { value: 'pass_fail_na', label: 'Pass / Fail / N-A' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'rating', label: 'Rating' },
] as const

async function togglePublished(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const id = String(formData.get('id') ?? '')
  const next = String(formData.get('next') ?? '') === 'true'
  await ctx.db((tx) =>
    tx.update(inspectionBanks).set({ isPublished: next }).where(eq(inspectionBanks.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: id,
    action: next ? 'publish' : 'update',
    summary: next ? 'Published' : 'Moved back to draft',
  })
  revalidatePath(`/inspections/banks/${id}`)
  revalidatePath('/inspections/banks')
}

async function addCriteria(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const bankId = String(formData.get('bankId') ?? '')
  const text = String(formData.get('text') ?? '').trim()
  if (!text) return
  const responseType = String(formData.get('responseType') ?? 'pass_fail_na') as
    | 'pass_fail_na'
    | 'yes_no'
    | 'rating'
  const requiresPhoto = String(formData.get('requiresPhoto') ?? '') === 'on'
  const requiresComment = String(formData.get('requiresComment') ?? '') === 'on'

  await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({ m: sql<number>`coalesce(max(${inspectionBankCriteria.sequence}), 0)`.mapWith(Number) })
      .from(inspectionBankCriteria)
      .where(eq(inspectionBankCriteria.bankId, bankId))
    const nextSeq = Number(maxRow?.m ?? 0) + 1
    await tx.insert(inspectionBankCriteria).values({
      tenantId: ctx.tenantId,
      bankId,
      sequence: nextSeq,
      text,
      responseType,
      requiresPhoto,
      requiresComment,
    })
  })
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: bankId,
    action: 'update',
    summary: `Added criterion: "${text.slice(0, 60)}"`,
  })
  revalidatePath(`/inspections/banks/${bankId}`)
}

async function moveCriteria(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const bankId = String(formData.get('bankId') ?? '')
  const criterionId = String(formData.get('criterionId') ?? '')
  const direction = String(formData.get('direction') ?? 'up') as 'up' | 'down'

  await ctx.db(async (tx) => {
    const [current] = await tx
      .select()
      .from(inspectionBankCriteria)
      .where(eq(inspectionBankCriteria.id, criterionId))
      .limit(1)
    if (!current) return
    const neighbour = await tx
      .select()
      .from(inspectionBankCriteria)
      .where(
        and(
          eq(inspectionBankCriteria.bankId, bankId),
          direction === 'up'
            ? lt(inspectionBankCriteria.sequence, current.sequence)
            : gt(inspectionBankCriteria.sequence, current.sequence),
        ),
      )
      .orderBy(
        direction === 'up' ? sql`sequence desc` : sql`sequence asc`,
      )
      .limit(1)
    const swapWith = neighbour[0]
    if (!swapWith) return
    await tx
      .update(inspectionBankCriteria)
      .set({ sequence: swapWith.sequence })
      .where(eq(inspectionBankCriteria.id, current.id))
    await tx
      .update(inspectionBankCriteria)
      .set({ sequence: current.sequence })
      .where(eq(inspectionBankCriteria.id, swapWith.id))
  })
  revalidatePath(`/inspections/banks/${bankId}`)
}

async function deleteCriteria(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const bankId = String(formData.get('bankId') ?? '')
  const criterionId = String(formData.get('criterionId') ?? '')
  await ctx.db((tx) =>
    tx.delete(inspectionBankCriteria).where(eq(inspectionBankCriteria.id, criterionId)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: bankId,
    action: 'delete',
    summary: 'Removed criterion',
  })
  revalidatePath(`/inspections/banks/${bankId}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Bank · ${id.slice(0, 8)}` }
}

export default async function InspectionBankDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

  const ctx = await requireModuleManage('inspections')
  const data = await ctx.db(async (tx) => {
    const [bank] = await tx
      .select()
      .from(inspectionBanks)
      .where(eq(inspectionBanks.id, id))
      .limit(1)
    if (!bank) return null
    const criteria = await tx
      .select()
      .from(inspectionBankCriteria)
      .where(eq(inspectionBankCriteria.bankId, id))
      .orderBy(asc(inspectionBankCriteria.sequence))
    return { bank, criteria }
  })

  if (!data) notFound()
  const { bank, criteria } = data
  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'inspection_bank', id, 50) : []

  const basePath = `/inspections/banks/${id}`

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/inspections/banks', label: 'Back to banks' }}
          title={bank.name}
          subtitle={bank.category ? bank.category.replace(/_/g, ' ') : undefined}
          badge={
            <Badge variant={bank.isPublished ? 'success' : 'secondary'}>
              {bank.isPublished ? 'Published' : 'Draft'}
            </Badge>
          }
          actions={
            <>
              <Link href={`/inspections/banks/${id}/edit`}>
                <Button variant="outline">
                  <Pencil size={14} />
                  Edit
                </Button>
              </Link>
              <form action={togglePublished}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="next" value={(!bank.isPublished).toString()} />
                <Button type="submit" variant={bank.isPublished ? 'outline' : 'default'}>
                  {bank.isPublished ? 'Unpublish' : 'Publish'}
                </Button>
              </form>
            </>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'criteria', label: 'Criteria', count: criteria.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Bank details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailGrid
                rows={[
                  { label: 'Name', value: bank.name },
                  { label: 'Category', value: bank.category?.replace(/_/g, ' ') ?? '—' },
                  {
                    label: 'Status',
                    value: (
                      <Badge variant={bank.isPublished ? 'success' : 'secondary'}>
                        {bank.isPublished ? 'Published' : 'Draft'}
                      </Badge>
                    ),
                  },
                  { label: 'Criteria', value: criteria.length },
                  { label: 'Created', value: new Date(bank.createdAt).toLocaleString() },
                  { label: 'Last updated', value: new Date(bank.updatedAt).toLocaleString() },
                ]}
              />
              {bank.description ? (
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Description
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                    {bank.description}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {active === 'criteria' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Criteria ({criteria.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {criteria.length === 0 ? (
                <EmptyState
                  icon={<ClipboardList size={24} />}
                  title="No criteria yet"
                  description="Add a question below to get started."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Question</TableHead>
                      <TableHead>Response</TableHead>
                      <TableHead>Photo</TableHead>
                      <TableHead>Comment</TableHead>
                      <TableHead className="w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criteria.map((c, i) => {
                      const isFirst = i === 0
                      const isLast = i === criteria.length - 1
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-xs tabular-nums text-slate-500">
                            {c.sequence}
                          </TableCell>
                          <TableCell>{c.text}</TableCell>
                          <TableCell className="text-slate-600">
                            {c.responseType.replace(/_/g, ' ')}
                          </TableCell>
                          <TableCell>
                            {c.requiresPhoto ? (
                              <Badge variant="secondary">Required</Badge>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {c.requiresComment ? (
                              <Badge variant="secondary">Required</Badge>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <form action={moveCriteria}>
                                <input type="hidden" name="bankId" value={id} />
                                <input type="hidden" name="criterionId" value={c.id} />
                                <input type="hidden" name="direction" value="up" />
                                <button
                                  type="submit"
                                  disabled={isFirst}
                                  aria-label="Move up"
                                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  <ArrowUp size={14} />
                                </button>
                              </form>
                              <form action={moveCriteria}>
                                <input type="hidden" name="bankId" value={id} />
                                <input type="hidden" name="criterionId" value={c.id} />
                                <input type="hidden" name="direction" value="down" />
                                <button
                                  type="submit"
                                  disabled={isLast}
                                  aria-label="Move down"
                                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  <ArrowDown size={14} />
                                </button>
                              </form>
                              <form action={deleteCriteria}>
                                <input type="hidden" name="bankId" value={id} />
                                <input type="hidden" name="criterionId" value={c.id} />
                                <button
                                  type="submit"
                                  aria-label="Delete"
                                  className="rounded p-1 text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </form>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add criterion</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={addCriteria} className="space-y-3">
                <input type="hidden" name="bankId" value={id} />
                <div className="space-y-1.5">
                  <Label>Question</Label>
                  <Input name="text" required placeholder="e.g. Are walkways clear?" />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Response type</Label>
                    <Select name="responseType" defaultValue="pass_fail_na">
                      {RESPONSE_TYPES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      name="requiresPhoto"
                      id="requiresPhoto"
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <Label htmlFor="requiresPhoto" className="!m-0 cursor-pointer">
                      Photo required
                    </Label>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      name="requiresComment"
                      id="requiresComment"
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <Label htmlFor="requiresComment" className="!m-0 cursor-pointer">
                      Comment required
                    </Label>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit">Add criterion</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {active === 'activity' ? (
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
