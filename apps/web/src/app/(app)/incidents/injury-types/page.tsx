// /incidents/injury-types — flat CRUD over the tenant's injury-type
// taxonomy.  Each incident_injury row picks one of these.
//
// Single-page admin: table on the left, inline-add form on the right.

import { revalidatePath } from 'next/cache'
import { Plus, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { asc, eq, count, sql } from 'drizzle-orm'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { incidentInjuries, incidentInjuryTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { IncidentsSubNav } from '../_sub-nav'

export const metadata = { title: 'Injury types' }
export const dynamic = 'force-dynamic'

async function createInjuryType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const description = String(formData.get('description') ?? '').trim() || null
  const oshaCode = String(formData.get('oshaCode') ?? '').trim() || null

  const [row] = await ctx.db((tx) =>
    tx
      .insert(incidentInjuryTypes)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        oshaCode,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'incident_injury_type',
      entityId: row.id,
      action: 'create',
      summary: `Added injury type "${name}"`,
      after: { name, oshaCode },
    })
  }
  revalidatePath('/incidents/injury-types')
}

async function updateInjuryType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const description = String(formData.get('description') ?? '').trim() || null
  const oshaCode = String(formData.get('oshaCode') ?? '').trim() || null

  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentInjuryTypes)
      .where(eq(incidentInjuryTypes.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) return

  await ctx.db((tx) =>
    tx
      .update(incidentInjuryTypes)
      .set({ name, description, oshaCode })
      .where(eq(incidentInjuryTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident_injury_type',
    entityId: id,
    action: 'update',
    summary: `Updated "${name}"`,
    before: { name: before.name, description: before.description, oshaCode: before.oshaCode },
    after: { name, description, oshaCode },
  })
  revalidatePath('/incidents/injury-types')
}

async function toggleArchive(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const next = formData.get('isActive') === 'true' ? 1 : 0
  if (!id) return
  await ctx.db((tx) =>
    tx.update(incidentInjuryTypes).set({ isActive: next }).where(eq(incidentInjuryTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident_injury_type',
    entityId: id,
    action: 'update',
    summary: next ? 'Restored from archive' : 'Archived',
    after: { isActive: !!next },
  })
  revalidatePath('/incidents/injury-types')
}

async function deleteInjuryType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const [{ usage }] = await ctx.db((tx) =>
    tx
      .select({ usage: count() })
      .from(incidentInjuries)
      .where(eq(incidentInjuries.injuryTypeId, id)),
  )
  if (Number(usage ?? 0) > 0) {
    await ctx.db((tx) =>
      tx
        .update(incidentInjuryTypes)
        .set({ isActive: 0 })
        .where(eq(incidentInjuryTypes.id, id)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_injury_type',
      entityId: id,
      action: 'archive',
      summary: 'Archived (referenced by existing injuries — hard delete refused)',
    })
  } else {
    await ctx.db((tx) =>
      tx.delete(incidentInjuryTypes).where(eq(incidentInjuryTypes.id, id)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_injury_type',
      entityId: id,
      action: 'delete',
      summary: 'Deleted injury type',
    })
  }
  revalidatePath('/incidents/injury-types')
}

export default async function InjuryTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const editingId =
    typeof sp.edit === 'string' ? sp.edit : Array.isArray(sp.edit) ? sp.edit[0] : undefined
  const ctx = await requireRequestContext()

  const { rows, usageById } = await ctx.db(async (tx) => {
    const all = await tx
      .select()
      .from(incidentInjuryTypes)
      .orderBy(asc(incidentInjuryTypes.name))
    const usage = await tx
      .select({ id: incidentInjuries.injuryTypeId, c: count() })
      .from(incidentInjuries)
      .where(sql`${incidentInjuries.injuryTypeId} is not null`)
      .groupBy(incidentInjuries.injuryTypeId)
    const usageMap: Record<string, number> = {}
    for (const u of usage) if (u.id) usageMap[u.id] = Number(u.c)
    return { rows: all, usageById: usageMap }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Injury types"
            description="Flat list of injury labels (laceration, strain, fracture, burn, …). Used by every injury row on every incident."
          />
          <IncidentsSubNav active="injury-types" />
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Plus size={32} />}
              title="No injury types yet"
              description="Add the labels your investigators reach for — laceration, strain, fracture, burn, chemical exposure, etc."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>OSHA code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) =>
                  editingId === r.id ? (
                    <TableRow key={r.id}>
                      <TableCell colSpan={5}>
                        <form action={updateInjuryType} className="space-y-2">
                          <input type="hidden" name="id" value={r.id} />
                          <div className="grid grid-cols-[1fr_140px] gap-2">
                            <Input name="name" required defaultValue={r.name} />
                            <Input
                              name="oshaCode"
                              defaultValue={r.oshaCode ?? ''}
                              placeholder="OSHA code"
                            />
                          </div>
                          <Textarea name="description" rows={2} defaultValue={r.description ?? ''} />
                          <div className="flex items-center gap-2">
                            <Button type="submit" size="sm">
                              Save
                            </Button>
                            <a
                              href="/incidents/injury-types"
                              className="text-sm text-slate-500 hover:underline"
                            >
                              Cancel
                            </a>
                          </div>
                        </form>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{r.name}</div>
                        {r.description ? (
                          <div className="text-xs text-slate-500">{r.description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {r.oshaCode ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            {r.oshaCode}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-300 text-amber-800">
                            Archived
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600 tabular-nums">
                        {usageById[r.id] ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <a
                            href={`/incidents/injury-types?edit=${r.id}`}
                            className="text-xs text-teal-700 hover:underline"
                          >
                            Edit
                          </a>
                          <form action={toggleArchive} className="inline">
                            <input type="hidden" name="id" value={r.id} />
                            <input
                              type="hidden"
                              name="isActive"
                              value={r.isActive ? 'false' : 'true'}
                            />
                            <button
                              type="submit"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              title={r.isActive ? 'Archive' : 'Restore'}
                            >
                              {r.isActive ? <Archive size={14} /> : <ArchiveRestore size={14} />}
                            </button>
                          </form>
                          <form action={deleteInjuryType} className="inline">
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              type="submit"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                              title={
                                (usageById[r.id] ?? 0) > 0
                                  ? `${usageById[r.id]} injuries — will archive instead`
                                  : 'Delete'
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Add injury type</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createInjuryType} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" name="name" required placeholder="e.g. Laceration" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="oshaCode">OSHA code</Label>
                  <Input id="oshaCode" name="oshaCode" placeholder="Optional, e.g. CUT" maxLength={8} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={2}
                    placeholder="Optional notes"
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit">
                    <Plus size={14} /> Add
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </ListPageLayout>
  )
}
