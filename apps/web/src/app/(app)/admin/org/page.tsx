import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { ArrowUpRight, Plus, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Select,
} from '@beaconhs/ui'
import Link from 'next/link'
import { crews, departments, orgUnits, people, trades } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { levelLabel } from '@/lib/org-hierarchy'
import { PageContainer } from '@/components/page-layout'
import { ConfirmButton } from '@/components/confirm-button'

export const metadata = { title: 'Org hierarchy' }
export const dynamic = 'force-dynamic'

const LEVELS = ['customer', 'project', 'site', 'area'] as const

// Org hierarchy is admin configuration. Every action here is a POST endpoint,
// so each must gate itself — the page render gate does not protect them.
// `can` already returns true for super-admins.
async function requireOrgAdmin() {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.org.manage')) redirect('/admin')
  return ctx
}

function backWithError(message: string): never {
  redirect(`/admin/org?error=${encodeURIComponent(message)}`)
}

async function addOrgUnit(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const name = String(formData.get('name') ?? '').trim()
  const level = String(formData.get('level') ?? '') as (typeof LEVELS)[number]
  const parentId = String(formData.get('parentId') ?? '').trim() || null
  if (!name || !LEVELS.includes(level)) return
  const [row] = await ctx.db((tx) =>
    tx.insert(orgUnits).values({ tenantId: ctx.tenantId, name, level, parentId }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'org_unit',
      entityId: row.id,
      action: 'create',
      summary: `Added ${level} "${name}"`,
    })
  }
  revalidatePath('/admin/org')
}

// Archive (soft delete), matching /locations semantics — org units are shared
// with the locations module, which restores archived units. Non-cascading:
// descendants are left untouched and stay visible in the tree.
async function deleteOrgUnit(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u ?? null
  })
  if (!before || before.deletedAt) return
  await ctx.db((tx) =>
    tx.update(orgUnits).set({ deletedAt: new Date() }).where(eq(orgUnits.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'org_unit',
    entityId: id,
    action: 'archive',
    summary: `Archived ${before.level} "${before.name}"`,
    before: before as unknown as Record<string, unknown>,
  })
  revalidatePath('/admin/org')
  revalidatePath('/locations')
}

async function addTrade(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const [row] = await ctx.db((tx) =>
    tx.insert(trades).values({ tenantId: ctx.tenantId, name }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'trade',
      entityId: row.id,
      action: 'create',
      summary: `Added trade "${name}"`,
    })
  }
  revalidatePath('/admin/org')
}

async function deleteTrade(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { row, usage } = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(trades).where(eq(trades.id, id)).limit(1)
    const [u] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.tradeId, id), isNull(people.deletedAt)))
    return { row: r ?? null, usage: Number(u?.c ?? 0) }
  })
  if (!row) return
  if (usage > 0) {
    backWithError(
      `"${row.name}" is assigned to ${usage} ${usage === 1 ? 'person' : 'people'}. Reassign them before deleting.`,
    )
  }
  await ctx.db((tx) => tx.delete(trades).where(eq(trades.id, id)))
  await recordAudit(ctx, {
    entityType: 'trade',
    entityId: id,
    action: 'delete',
    summary: `Deleted trade "${row.name}"`,
    before: { name: row.name },
  })
  revalidatePath('/admin/org')
}

async function addCrew(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const [row] = await ctx.db((tx) =>
    tx.insert(crews).values({ tenantId: ctx.tenantId, name }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'crew',
      entityId: row.id,
      action: 'create',
      summary: `Added crew "${name}"`,
    })
  }
  revalidatePath('/admin/org')
}

async function deleteCrew(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { row, usage } = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(crews).where(eq(crews.id, id)).limit(1)
    const [u] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.crewId, id), isNull(people.deletedAt)))
    return { row: r ?? null, usage: Number(u?.c ?? 0) }
  })
  if (!row) return
  if (usage > 0) {
    backWithError(
      `"${row.name}" is assigned to ${usage} ${usage === 1 ? 'person' : 'people'}. Reassign them before deleting.`,
    )
  }
  await ctx.db((tx) => tx.delete(crews).where(eq(crews.id, id)))
  await recordAudit(ctx, {
    entityType: 'crew',
    entityId: id,
    action: 'delete',
    summary: `Deleted crew "${row.name}"`,
    before: { name: row.name },
  })
  revalidatePath('/admin/org')
}

export default async function AdminOrgPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireOrgAdmin()
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const [allUnits, depts, allTrades, allCrews] = await ctx.db(async (tx) => {
    const u = await tx
      .select()
      .from(orgUnits)
      .where(isNull(orgUnits.deletedAt))
      .orderBy(asc(orgUnits.name))
    const d = await tx.select().from(departments).orderBy(asc(departments.name))
    const t = await tx.select().from(trades).orderBy(asc(trades.name))
    const c = await tx.select().from(crews).orderBy(asc(crews.name))
    return [u, d, t, c] as const
  })

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Org hierarchy"
          subtitle="Locations, projects, sites, areas + crews / trades"
        />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Org units ({allUnits.length})</CardTitle>
              <CardDescription>
                Hierarchical tree by level. Archiving hides a unit here and in pickers — restore it
                from the Locations module.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <OrgTree units={allUnits} onDelete={deleteOrgUnit} />
              <form
                action={addOrgUnit}
                className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50/50 p-3 sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-800/40"
              >
                <Field label="Level">
                  <Select name="level" defaultValue="site">
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {levelLabel(l)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Parent (optional)">
                  <Select name="parentId" defaultValue="">
                    <option value="">— top-level —</option>
                    {allUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {levelLabel(u.level)}: {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Name" className="sm:col-span-1">
                  <Input name="name" placeholder="e.g. Site C" />
                </Field>
                <div className="flex items-end">
                  <Button type="submit" className="w-full">
                    <Plus size={14} /> Add
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Departments ({depts.length})</CardTitle>
                <CardDescription>Managed in People.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {depts.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">None.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {depts.map((d) => (
                      <li key={d.id} className="rounded px-2 py-1">
                        {d.name}
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href="/people/departments"
                  className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
                >
                  Manage departments <ArrowUpRight size={13} />
                </Link>
              </CardContent>
            </Card>
            <NameListCard
              title="Trades"
              items={allTrades}
              addAction={addTrade}
              deleteAction={deleteTrade}
            />
            <NameListCard
              title="Crews"
              items={allCrews}
              addAction={addCrew}
              deleteAction={deleteCrew}
            />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

function OrgTree({
  units,
  onDelete,
}: {
  units: (typeof orgUnits.$inferSelect)[]
  onDelete: (fd: FormData) => Promise<void>
}) {
  const visibleIds = new Set(units.map((u) => u.id))
  const byParent = new Map<string | null, typeof units>()
  for (const u of units) {
    // Units whose parent is archived render as roots so nothing disappears
    // silently (archiving is non-cascading).
    const k = u.parentId && visibleIds.has(u.parentId) ? u.parentId : null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(u)
  }

  function render(parentId: string | null, depth: number): React.ReactNode {
    const children = byParent.get(parentId) ?? []
    if (children.length === 0) return null
    return (
      <ul
        className={depth === 0 ? '' : 'ml-4 border-l border-slate-200 pl-3 dark:border-slate-800'}
      >
        {children.map((u) => (
          <li key={u.id} className="py-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{levelLabel(u.level)}</Badge>
                <span className="text-sm font-medium">{u.name}</span>
                {u.code ? (
                  <span className="text-xs text-slate-400 dark:text-slate-500">{u.code}</span>
                ) : null}
              </div>
              <form action={onDelete} className="inline">
                <input type="hidden" name="id" value={u.id} />
                <ConfirmButton
                  message={`Archive "${u.name}"? It disappears from pickers and this tree; restore it from the Locations module.`}
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 dark:hover:text-red-400"
                >
                  <Trash2 size={12} />
                </ConfirmButton>
              </form>
            </div>
            {render(u.id, depth + 1)}
          </li>
        ))}
      </ul>
    )
  }

  if (units.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No org units.</p>
  }
  return render(null, 0)
}

function NameListCard({
  title,
  items,
  addAction,
  deleteAction,
}: {
  title: string
  items: { id: string; name: string }[]
  addAction: (fd: FormData) => Promise<void>
  deleteAction: (fd: FormData) => Promise<void>
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {title} ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">None.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {items.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <span>{i.name}</span>
                <form action={deleteAction} className="inline">
                  <input type="hidden" name="id" value={i.id} />
                  <ConfirmButton
                    message={`Delete "${i.name}"? This cannot be undone.`}
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 dark:hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addAction} className="flex gap-1">
          <Input name="name" placeholder="Add new" className="h-8 text-sm" />
          <Button type="submit" size="sm" variant="outline">
            <Plus size={12} />
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}
