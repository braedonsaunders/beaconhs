import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { HardHat } from 'lucide-react'
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
  people,
  ppeInspections,
  ppeIssueReports,
  ppeIssues,
  ppeItems,
  ppeTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'

export const dynamic = 'force-dynamic'

async function recordInspection(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '')
  const kind = String(formData.get('kind') ?? 'pre_use') as 'pre_use' | 'annual'
  const result = String(formData.get('result') ?? 'pass') as 'pass' | 'fail' | 'n_a'
  const notes = String(formData.get('notes') ?? '').trim() || null
  const today = new Date().toISOString().slice(0, 10)
  await ctx.db(async (tx) => {
    await tx.insert(ppeInspections).values({
      tenantId: ctx.tenantId,
      itemId,
      kind,
      result,
      inspectedOn: today,
      nextDueOn: nextDueDate(kind, today),
      notes,
      inspectedByTenantUserId: ctx.membership?.id,
    })
    // Update the cached "last/next" fields on the item.
    const set = kind === 'pre_use'
      ? { lastInspectionOn: today, nextInspectionDue: nextDueDate(kind, today) }
      : { lastAnnualInspectionOn: today, nextAnnualInspectionDue: nextDueDate(kind, today) }
    await tx.update(ppeItems).set(set).where(eq(ppeItems.id, itemId))
  })
  revalidatePath(`/ppe/${itemId}`)
}

async function setStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '')
  const status = String(formData.get('status') ?? '') as 'in_stock' | 'issued' | 'returned' | 'damaged' | 'discarded' | 'expired'
  await ctx.db((tx) => tx.update(ppeItems).set({ status }).where(eq(ppeItems.id, itemId)))
  revalidatePath(`/ppe/${itemId}`)
}

async function reportIssue(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '')
  const description = String(formData.get('description') ?? '').trim()
  if (!description) return
  await ctx.db((tx) =>
    tx.insert(ppeIssueReports).values({
      tenantId: ctx.tenantId,
      itemId,
      description,
      status: 'open',
      reportedByTenantUserId: ctx.membership?.id,
    }),
  )
  revalidatePath(`/ppe/${itemId}`)
}

function nextDueDate(kind: 'pre_use' | 'annual', iso: string): string {
  const d = new Date(iso)
  if (kind === 'annual') d.setFullYear(d.getFullYear() + 1)
  else d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `PPE · ${id.slice(0, 8)}` }
}

export default async function PpeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(eq(ppeItems.id, id))
      .limit(1)
    if (!row) return null

    const [inspections, issuesLog, issueReports] = await Promise.all([
      tx
        .select()
        .from(ppeInspections)
        .where(eq(ppeInspections.itemId, id))
        .orderBy(desc(ppeInspections.inspectedOn)),
      tx
        .select({ issue: ppeIssues, person: people })
        .from(ppeIssues)
        .leftJoin(people, eq(people.id, ppeIssues.personId))
        .where(eq(ppeIssues.itemId, id))
        .orderBy(desc(ppeIssues.occurredAt)),
      tx
        .select()
        .from(ppeIssueReports)
        .where(eq(ppeIssueReports.itemId, id))
        .orderBy(desc(ppeIssueReports.reportedAt)),
    ])
    return { ...row, inspections, issuesLog, issueReports }
  })

  if (!data) notFound()
  const { item, type, holder, inspections, issuesLog, issueReports } = data
  const openIssues = issueReports.filter((r) => r.status === 'open')

  return (
    <div className="space-y-5">
      <DetailHeader
        back={{ href: '/ppe', label: 'Back to PPE' }}
        title={`${type.name} · ${item.serialNumber ?? 'no serial'}`}
        subtitle={`Size ${item.size ?? '—'} · ${type.category ?? ''}`}
        badge={
          <div className="flex items-center gap-2">
            <Badge variant={item.status === 'issued' ? 'success' : item.status === 'in_stock' ? 'secondary' : 'warning'}>
              {item.status.replace('_', ' ')}
            </Badge>
            {openIssues.length > 0 ? (
              <Badge variant="destructive">{openIssues.length} open issue{openIssues.length === 1 ? '' : 's'}</Badge>
            ) : null}
          </div>
        }
      />

      {openIssues.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Open issue report</AlertTitle>
          <AlertDescription>{openIssues[0]!.description}</AlertDescription>
        </Alert>
      ) : null}

      <Section title="General">
        <DetailGrid
          rows={[
            { label: 'Type', value: type.name },
            { label: 'Serial #', value: item.serialNumber ?? '—' },
            { label: 'Size', value: item.size ?? '—' },
            { label: 'Currently with', value: holder ? <Link href={`/people/${holder.id}`} className="text-teal-700 hover:underline">{holder.firstName} {holder.lastName}</Link> : '—' },
            { label: 'Purchased', value: item.purchaseDate ?? '—' },
            { label: 'Expires', value: item.expiresOn ?? '—' },
            { label: 'Last inspection', value: item.lastInspectionOn ?? '—' },
            { label: 'Next inspection due', value: item.nextInspectionDue ?? '—' },
            { label: 'Last annual', value: item.lastAnnualInspectionOn ?? '—' },
            { label: 'Next annual due', value: item.nextAnnualInspectionDue ?? '—' },
          ]}
        />
      </Section>

      <Section title={`Inspections (${inspections.length})`}>
        {inspections.length === 0 ? (
          <EmptyState icon={<HardHat size={24} />} title="No inspections recorded" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.inspectedOn}</TableCell>
                  <TableCell>{i.kind.replace('_', ' ')}</TableCell>
                  <TableCell>
                    <Badge variant={i.result === 'pass' ? 'success' : i.result === 'fail' ? 'destructive' : 'secondary'}>
                      {i.result.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{i.nextDueOn ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{i.notes ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/50 p-4">
          <h4 className="mb-2 text-sm font-semibold">Record new inspection</h4>
          <form action={recordInspection} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input type="hidden" name="itemId" value={id} />
            <div className="space-y-1">
              <Label className="text-xs">Kind</Label>
              <Select name="kind" defaultValue="pre_use">
                <option value="pre_use">Pre-use</option>
                <option value="annual">Annual</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Result</Label>
              <Select name="result" defaultValue="pass">
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="n_a">N/A</option>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Notes</Label>
              <Input name="notes" placeholder="Anything to flag?" />
            </div>
            <div className="sm:col-span-4">
              <Button type="submit">Record inspection</Button>
            </div>
          </form>
        </div>
      </Section>

      <Section title={`Issue reports (${issueReports.length})`}>
        {issueReports.length === 0 ? (
          <p className="text-sm text-slate-500">No issues reported.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {issueReports.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium">{r.description}</div>
                  <div className="text-xs text-slate-500">
                    Reported {new Date(r.reportedAt).toLocaleDateString()}
                    {r.resolvedAt ? ` · resolved ${new Date(r.resolvedAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <Badge variant={r.status === 'open' ? 'destructive' : 'success'}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/50 p-4">
          <h4 className="mb-2 text-sm font-semibold">Report a new issue</h4>
          <form action={reportIssue} className="space-y-2">
            <input type="hidden" name="itemId" value={id} />
            <Textarea
              name="description"
              rows={2}
              placeholder="Frayed strap, missing buckle, damage from drop, etc."
              required
            />
            <Button type="submit" variant="destructive">
              Report issue
            </Button>
          </form>
        </div>
      </Section>

      <Section title={`Issue / return / replace log (${issuesLog.length})`} defaultOpen={false}>
        {issuesLog.length === 0 ? (
          <p className="text-sm text-slate-500">No issuance history.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issuesLog.map((row) => (
                <TableRow key={row.issue.id}>
                  <TableCell>{new Date(row.issue.occurredAt).toLocaleDateString()}</TableCell>
                  <TableCell>{row.issue.action}</TableCell>
                  <TableCell>
                    {row.person ? (
                      <Link href={`/people/${row.person.id}`} className="text-teal-700 hover:underline">
                        {row.person.firstName} {row.person.lastName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600">{row.issue.note ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={setStatus} className="flex items-end gap-3">
            <input type="hidden" name="itemId" value={id} />
            <div className="space-y-1.5">
              <Label>Set status</Label>
              <Select name="status" defaultValue={item.status}>
                {['in_stock', 'issued', 'returned', 'damaged', 'discarded', 'expired'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit">Update</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
