import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, gt, lt, not, sql } from 'drizzle-orm'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
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
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  inspectionBankCriteria,
  inspectionBanks,
  inspectionTypeBanks,
  inspectionTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailPageLayout } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ActivityFeed } from '@/components/activity-feed'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'banks', 'activity'] as const
type Tab = (typeof TABS)[number]

async function togglePublished(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const next = String(formData.get('next') ?? '') === 'true'
  await ctx.db((tx) =>
    tx.update(inspectionTypes).set({ isPublished: next }).where(eq(inspectionTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: id,
    action: next ? 'publish' : 'update',
    summary: next ? 'Published' : 'Moved back to draft',
  })
  revalidatePath(`/inspections/types/${id}`)
  revalidatePath('/inspections/types')
}

async function attachBank(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '')
  const bankId = String(formData.get('bankId') ?? '')
  if (!typeId || !bankId) return

  await ctx.db(async (tx) => {
    // Order goes at the end of the list
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${inspectionTypeBanks.sequence}), -1)`.mapWith(Number),
      })
      .from(inspectionTypeBanks)
      .where(eq(inspectionTypeBanks.typeId, typeId))
    const nextSeq = Number(maxRow?.m ?? -1) + 1
    await tx
      .insert(inspectionTypeBanks)
      .values({
        tenantId: ctx.tenantId,
        typeId,
        bankId,
        sequence: nextSeq,
      })
      .onConflictDoNothing()
  })

  const bank = await ctx.db(async (tx) => {
    const [b] = await tx
      .select({ name: inspectionBanks.name })
      .from(inspectionBanks)
      .where(eq(inspectionBanks.id, bankId))
      .limit(1)
    return b
  })

  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: typeId,
    action: 'update',
    summary: `Linked bank "${bank?.name ?? bankId.slice(0, 8)}"`,
  })
  revalidatePath(`/inspections/types/${typeId}`)
}

async function detachBank(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '')
  const linkId = String(formData.get('linkId') ?? '')
  await ctx.db((tx) => tx.delete(inspectionTypeBanks).where(eq(inspectionTypeBanks.id, linkId)))
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: typeId,
    action: 'update',
    summary: 'Unlinked bank from type',
  })
  revalidatePath(`/inspections/types/${typeId}`)
}

async function moveBank(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '')
  const linkId = String(formData.get('linkId') ?? '')
  const direction = String(formData.get('direction') ?? 'up') as 'up' | 'down'

  await ctx.db(async (tx) => {
    const [current] = await tx
      .select()
      .from(inspectionTypeBanks)
      .where(eq(inspectionTypeBanks.id, linkId))
      .limit(1)
    if (!current) return
    const neighbour = await tx
      .select()
      .from(inspectionTypeBanks)
      .where(
        and(
          eq(inspectionTypeBanks.typeId, typeId),
          direction === 'up'
            ? lt(inspectionTypeBanks.sequence, current.sequence)
            : gt(inspectionTypeBanks.sequence, current.sequence),
        ),
      )
      .orderBy(
        direction === 'up' ? sql`sequence desc` : sql`sequence asc`,
      )
      .limit(1)
    const swap = neighbour[0]
    if (!swap) return
    await tx
      .update(inspectionTypeBanks)
      .set({ sequence: swap.sequence })
      .where(eq(inspectionTypeBanks.id, current.id))
    await tx
      .update(inspectionTypeBanks)
      .set({ sequence: current.sequence })
      .where(eq(inspectionTypeBanks.id, swap.id))
  })
  revalidatePath(`/inspections/types/${typeId}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Inspection type · ${id.slice(0, 8)}` }
}

export default async function InspectionTypeDetailPage({
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
    const [type] = await tx
      .select()
      .from(inspectionTypes)
      .where(eq(inspectionTypes.id, id))
      .limit(1)
    if (!type) return null
    const links = await tx
      .select({
        link: inspectionTypeBanks,
        bank: inspectionBanks,
        criteriaCount: sql<number>`count(${inspectionBankCriteria.id})`.mapWith(Number),
      })
      .from(inspectionTypeBanks)
      .innerJoin(inspectionBanks, eq(inspectionBanks.id, inspectionTypeBanks.bankId))
      .leftJoin(inspectionBankCriteria, eq(inspectionBankCriteria.bankId, inspectionBanks.id))
      .where(eq(inspectionTypeBanks.typeId, id))
      .groupBy(inspectionTypeBanks.id, inspectionBanks.id)
      .orderBy(asc(inspectionTypeBanks.sequence))
    const linkedBankIds = new Set(links.map((l) => l.bank.id))
    const availableBanks = await tx
      .select({ id: inspectionBanks.id, name: inspectionBanks.name, category: inspectionBanks.category })
      .from(inspectionBanks)
      .where(eq(inspectionBanks.isPublished, true))
      .orderBy(asc(inspectionBanks.name))
    return {
      type,
      links,
      availableBanks: availableBanks.filter((b) => !linkedBankIds.has(b.id)),
    }
  })
  if (!data) notFound()
  const { type, links, availableBanks } = data
  const totalCriteria = links.reduce((s, l) => s + Number(l.criteriaCount ?? 0), 0)
  const activity = active === 'activity' ? await recentActivityForEntity(ctx, 'inspection_type', id, 50) : []
  const basePath = `/inspections/types/${id}`

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/inspections/types', label: 'Back to inspection types' }}
          title={type.name}
          subtitle={type.description ?? undefined}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={type.isPublished ? 'success' : 'secondary'}>
                {type.isPublished ? 'Published' : 'Draft'}
              </Badge>
              {type.requiresForeman ? <Badge variant="outline">Foreman required</Badge> : null}
              {type.requiresCustomerSignature ? (
                <Badge variant="outline">Customer sig required</Badge>
              ) : null}
            </div>
          }
          actions={
            <>
              <Link href={`/inspections/types/${id}/edit`}>
                <Button variant="outline">
                  <Pencil size={14} />
                  Edit
                </Button>
              </Link>
              <form action={togglePublished}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="next" value={(!type.isPublished).toString()} />
                <Button type="submit" variant={type.isPublished ? 'outline' : 'default'}>
                  {type.isPublished ? 'Unpublish' : 'Publish'}
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
            { key: 'banks', label: 'Question banks', count: links.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? (
        <div className="space-y-4">
          <Section title="Type configuration" subtitle="What this inspection requires when run">
            <DetailGrid
              rows={[
                { label: 'Name', value: type.name },
                {
                  label: 'Status',
                  value: (
                    <Badge variant={type.isPublished ? 'success' : 'secondary'}>
                      {type.isPublished ? 'Published' : 'Draft'}
                    </Badge>
                  ),
                },
                { label: 'Banks linked', value: links.length },
                { label: 'Total criteria', value: totalCriteria },
                {
                  label: 'Foreman required',
                  value: type.requiresForeman ? 'Yes' : 'No',
                },
                {
                  label: 'Customer signature required',
                  value: type.requiresCustomerSignature ? 'Yes' : 'No',
                },
                {
                  label: 'Auto-spawn CAs on fail',
                  value: type.enableCorrectiveActions ? 'Yes (severity ≥ high)' : 'No',
                },
                { label: 'Default cadence', value: type.defaultCadence ?? '—' },
                {
                  label: 'Created',
                  value: new Date(type.createdAt).toLocaleString(),
                },
                {
                  label: 'Last updated',
                  value: new Date(type.updatedAt).toLocaleString(),
                },
              ]}
            />
            {type.description ? (
              <div className="mt-4 text-sm text-slate-700">
                <div className="text-xs uppercase tracking-wide text-slate-500">Description</div>
                <p className="mt-1 whitespace-pre-wrap">{type.description}</p>
              </div>
            ) : null}
          </Section>
          <Section title="Next steps">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>
                <Link href={`/inspections/types/${id}?tab=banks`} className="text-teal-700 hover:underline">
                  Attach one or more question banks
                </Link>{' '}
                so inspectors have something to check.
              </li>
              <li>
                <Link href={`/inspections/records/new?typeId=${id}`} className="text-teal-700 hover:underline">
                  Start an inspection
                </Link>{' '}
                using this type.
              </li>
              <li>
                <Link href={`/inspections/assignments/new?typeId=${id}`} className="text-teal-700 hover:underline">
                  Assign on a recurring cadence
                </Link>{' '}
                to make sure people don't skip it.
              </li>
            </ul>
          </Section>
        </div>
      ) : null}

      {active === 'banks' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Linked question banks ({links.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {links.length === 0 ? (
                <EmptyState
                  icon={<span className="text-2xl">📋</span>}
                  title="No banks linked yet"
                  description="Pick a published bank below to add it to this inspection type."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Bank</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Criteria</TableHead>
                      <TableHead className="w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {links.map((row, i) => {
                      const isFirst = i === 0
                      const isLast = i === links.length - 1
                      return (
                        <TableRow key={row.link.id}>
                          <TableCell className="font-mono text-xs text-slate-500">
                            {row.link.sequence + 1}
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/inspections/banks/${row.bank.id}`}
                              className="font-medium hover:underline"
                            >
                              {row.bank.name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600 text-xs">
                            {row.bank.category?.replace(/_/g, ' ') ?? '—'}
                          </TableCell>
                          <TableCell className="tabular-nums text-slate-600">
                            {Number(row.criteriaCount ?? 0)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <form action={moveBank}>
                                <input type="hidden" name="typeId" value={id} />
                                <input type="hidden" name="linkId" value={row.link.id} />
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
                              <form action={moveBank}>
                                <input type="hidden" name="typeId" value={id} />
                                <input type="hidden" name="linkId" value={row.link.id} />
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
                              <form action={detachBank}>
                                <input type="hidden" name="typeId" value={id} />
                                <input type="hidden" name="linkId" value={row.link.id} />
                                <button
                                  type="submit"
                                  aria-label="Detach"
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
              <CardTitle>Attach a bank</CardTitle>
            </CardHeader>
            <CardContent>
              {availableBanks.length === 0 ? (
                <Alert variant="info">
                  <AlertTitle>No more banks to add</AlertTitle>
                  <AlertDescription>
                    Every published bank is already linked. Create a new bank from{' '}
                    <Link href="/inspections/banks/new" className="text-teal-700 hover:underline">
                      /inspections/banks/new
                    </Link>
                    .
                  </AlertDescription>
                </Alert>
              ) : (
                <form action={attachBank} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="typeId" value={id} />
                  <div className="min-w-[280px] flex-1 space-y-1.5">
                    <Label>Pick a bank</Label>
                    <Select name="bankId" required defaultValue="">
                      <option value="" disabled>
                        — Pick a bank —
                      </option>
                      {availableBanks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                          {b.category ? ` · ${b.category.replace(/_/g, ' ')}` : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="submit">Attach</Button>
                </form>
              )}
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
