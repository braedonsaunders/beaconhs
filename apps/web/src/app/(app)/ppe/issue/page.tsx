// /ppe/issue — dashboard-level issuance: pick a person + an in-stock PPE
// item and hand it to them. Also exposes the four lifecycle actions (return,
// replace, discard, mark damaged) on a single page so a front-line manager
// doesn't have to bounce through the item detail page for routine handouts.

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { ArrowLeftRight, LogOut, Trash2, Wrench } from 'lucide-react'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import {
  Badge,
  Button,
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
import { people, ppeIssues, ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PersonSelectField } from '@/components/person-select-field'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { PpeSubNav } from '@/components/ppe-sub-nav'
import { recordPpeIssueAction } from '../_lib'

export const metadata = { title: 'Issue PPE' }
export const dynamic = 'force-dynamic'

async function issuePpe(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const personId = String(formData.get('personId') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim() || null
  if (!itemId || !personId) return
  await recordPpeIssueAction(ctx, { itemId, personId, action: 'issue', note })
  revalidatePath('/ppe/issue')
  revalidatePath(`/ppe/${itemId}`)
  revalidatePath('/ppe')
}

async function returnPpe(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim() || null
  if (!itemId) return
  await recordPpeIssueAction(ctx, { itemId, personId: null, action: 'return', note })
  revalidatePath('/ppe/issue')
  revalidatePath(`/ppe/${itemId}`)
  revalidatePath('/ppe')
}

async function replacePpe(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const personId = String(formData.get('personId') ?? '').trim() || null
  const note = String(formData.get('note') ?? '').trim() || null
  if (!itemId) return
  await recordPpeIssueAction(ctx, { itemId, personId, action: 'replace', note })
  revalidatePath('/ppe/issue')
  revalidatePath(`/ppe/${itemId}`)
  revalidatePath('/ppe')
}

async function discardPpe(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim() || null
  if (!itemId) return
  await recordPpeIssueAction(ctx, { itemId, personId: null, action: 'discard', note })
  revalidatePath('/ppe/issue')
  revalidatePath(`/ppe/${itemId}`)
  revalidatePath('/ppe')
}

export default async function PpeIssuePage() {
  const ctx = await requireRequestContext()
  const { inStock, issued, peopleList, recentLedger, issuedCount, inStockCount } = await ctx.db(
    async (tx) => {
      const stock = await tx
        .select({ item: ppeItems, type: ppeTypes })
        .from(ppeItems)
        .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
        .where(eq(ppeItems.status, 'in_stock'))
        .orderBy(asc(ppeTypes.name), asc(ppeItems.serialNumber))
        .limit(500)
      const out = await tx
        .select({ item: ppeItems, type: ppeTypes, holder: people })
        .from(ppeItems)
        .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
        .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
        .where(eq(ppeItems.status, 'issued'))
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(500)
      const allPeople = await tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
        })
        .from(people)
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(500)
      const recent = await tx
        .select({
          issue: ppeIssues,
          item: ppeItems,
          type: ppeTypes,
          person: people,
        })
        .from(ppeIssues)
        .innerJoin(ppeItems, eq(ppeItems.id, ppeIssues.itemId))
        .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
        .leftJoin(people, eq(people.id, ppeIssues.personId))
        .orderBy(desc(ppeIssues.occurredAt))
        .limit(20)
      const [stockC] = await tx
        .select({ c: count() })
        .from(ppeItems)
        .where(eq(ppeItems.status, 'in_stock'))
      const [issC] = await tx
        .select({ c: count() })
        .from(ppeItems)
        .where(eq(ppeItems.status, 'issued'))
      return {
        inStock: stock,
        issued: out,
        peopleList: allPeople,
        recentLedger: recent,
        issuedCount: Number(issC?.c ?? 0),
        inStockCount: Number(stockC?.c ?? 0),
      }
    },
  )

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="issue" />
          <PageHeader title="Issue PPE" description="Issue, return, replace, or discard PPE." />
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{inStockCount} in stock</Badge>
            <Badge variant="warning">{issuedCount} currently issued</Badge>
          </div>
        </>
      }
    >
      <div className="space-y-6">
        <Section title="Issue PPE to a person" defaultOpen>
          {inStock.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing in stock — every item is issued, damaged, or discarded.
            </p>
          ) : (
            <form action={issuePpe} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label>PPE item *</Label>
                <Select name="itemId" required defaultValue="">
                  <option value="">— Select an in-stock item —</option>
                  {inStock.map(({ item, type }) => (
                    <option key={item.id} value={item.id}>
                      {type.name}
                      {item.serialNumber ? ` · ${item.serialNumber}` : ''}
                      {item.size ? ` · size ${item.size}` : ''}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-slate-500">
                  Only items with status "in stock" appear here ({inStock.length}).
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Hand to person *</Label>
                <PersonSelectField
                  name="personId"
                  defaultValue=""
                  options={peopleList.map((p) => ({
                    value: p.id,
                    label: `${p.lastName}, ${p.firstName}`,
                    hint: p.employeeNo ?? undefined,
                  }))}
                  placeholder="Select a person…"
                  clearable={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label>&nbsp;</Label>
                <Button type="submit">
                  <LogOut size={12} /> Issue
                </Button>
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label>Note</Label>
                <Input
                  name="note"
                  placeholder='Optional, e.g. "Replaces lost helmet, site induction"'
                />
              </div>
            </form>
          )}
        </Section>

        <Section
          title={`Currently issued (${issued.length})`}
          subtitle="One row per item handed out. Use the action button to take it back, log a replacement, or discard."
          defaultOpen
        >
          {issued.length === 0 ? (
            <EmptyState
              icon={<ArrowLeftRight size={28} />}
              title="Nothing currently issued"
              description="Every PPE item is in stock or out of service."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PPE</TableHead>
                    <TableHead>Holder</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issued.map(({ item, type, holder }) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link href={`/ppe/${item.id}`} className="hover:underline">
                          <div className="font-mono text-xs text-slate-500">
                            {item.serialNumber ?? '—'}
                          </div>
                          <div className="text-sm font-medium">{type.name}</div>
                          {item.size ? (
                            <div className="text-xs text-slate-500">size {item.size}</div>
                          ) : null}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {holder ? (
                          <Link
                            href={`/people/${holder.id}`}
                            className="text-teal-700 hover:underline"
                          >
                            {holder.firstName} {holder.lastName}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={returnPpe} className="flex items-center gap-1.5">
                            <input type="hidden" name="itemId" value={item.id} />
                            <Input name="note" placeholder="return note…" className="h-8 w-36" />
                            <Button type="submit" size="sm" variant="outline">
                              Return
                            </Button>
                          </form>
                          <form action={replacePpe} className="flex items-center gap-1.5">
                            <input type="hidden" name="itemId" value={item.id} />
                            <Input name="note" placeholder="replace note…" className="h-8 w-36" />
                            <Button type="submit" size="sm" variant="outline">
                              <Wrench size={12} /> Replace
                            </Button>
                          </form>
                          <form action={discardPpe}>
                            <input type="hidden" name="itemId" value={item.id} />
                            <Button type="submit" size="sm" variant="outline">
                              <Trash2 size={12} /> Discard
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
        </Section>

        <Section
          title="Recent ledger"
          subtitle="Last 20 issue / return / replace / discard events."
          defaultOpen={false}
        >
          {recentLedger.length === 0 ? (
            <p className="text-sm text-slate-500">No PPE activity.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLedger.map((r) => (
                  <TableRow key={r.issue.id}>
                    <TableCell>{new Date(r.issue.occurredAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.issue.action === 'issue'
                            ? 'success'
                            : r.issue.action === 'discard' || r.issue.action === 'mark_damaged'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {r.issue.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/ppe/${r.item.id}`} className="hover:underline">
                        {r.type.name}
                        {r.item.serialNumber ? ` · ${r.item.serialNumber}` : ''}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.person ? `${r.person.firstName} ${r.person.lastName}` : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">{r.issue.note ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </ListPageLayout>
  )
}
