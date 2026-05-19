import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import { Plus, Trash2 } from 'lucide-react'
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
import { crews, departments, orgUnits, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Org hierarchy' }
export const dynamic = 'force-dynamic'

const LEVELS = ['customer', 'project', 'site', 'area'] as const

async function addOrgUnit(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
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

async function deleteOrgUnit(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(orgUnits).where(eq(orgUnits.id, id)))
  await recordAudit(ctx, { entityType: 'org_unit', entityId: id, action: 'delete' })
  revalidatePath('/admin/org')
}

async function addDepartment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  await ctx.db((tx) => tx.insert(departments).values({ tenantId: ctx.tenantId, name }))
  revalidatePath('/admin/org')
}

async function deleteDepartment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(departments).where(eq(departments.id, id)))
  revalidatePath('/admin/org')
}

async function addTrade(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  await ctx.db((tx) => tx.insert(trades).values({ tenantId: ctx.tenantId, name }))
  revalidatePath('/admin/org')
}

async function deleteTrade(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(trades).where(eq(trades.id, id)))
  revalidatePath('/admin/org')
}

async function addCrew(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  await ctx.db((tx) => tx.insert(crews).values({ tenantId: ctx.tenantId, name }))
  revalidatePath('/admin/org')
}

async function deleteCrew(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(crews).where(eq(crews.id, id)))
  revalidatePath('/admin/org')
}

export default async function AdminOrgPage() {
  const ctx = await requireRequestContext()
  const [allUnits, depts, allTrades, allCrews] = await ctx.db(async (tx) => {
    const u = await tx.select().from(orgUnits).orderBy(asc(orgUnits.name))
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
          subtitle="Customers, projects, sites, areas + crews / departments / trades"
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Org units ({allUnits.length})</CardTitle>
              <CardDescription>Hierarchical tree by level.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <OrgTree units={allUnits} onDelete={deleteOrgUnit} />
              <form action={addOrgUnit} className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50/50 p-3 sm:grid-cols-4">
                <Field label="Level">
                  <Select name="level" defaultValue="site">
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Parent (optional)">
                  <Select name="parentId" defaultValue="">
                    <option value="">— top-level —</option>
                    {allUnits.map((u) => (
                      <option key={u.id} value={u.id}>{u.level}: {u.name}</option>
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
            <NameListCard
              title="Departments"
              items={depts}
              addAction={addDepartment}
              deleteAction={deleteDepartment}
            />
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
  units: typeof orgUnits.$inferSelect[]
  onDelete: (fd: FormData) => Promise<void>
}) {
  const byParent = new Map<string | null, typeof units>()
  for (const u of units) {
    const k = u.parentId
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(u)
  }

  function render(parentId: string | null, depth: number): React.ReactNode {
    const children = byParent.get(parentId) ?? []
    if (children.length === 0) return null
    return (
      <ul className={depth === 0 ? '' : 'ml-4 border-l border-slate-200 pl-3'}>
        {children.map((u) => (
          <li key={u.id} className="py-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{u.level}</Badge>
                <span className="text-sm font-medium">{u.name}</span>
                {u.code ? <span className="text-xs text-slate-400">{u.code}</span> : null}
              </div>
              <form action={onDelete} className="inline">
                <input type="hidden" name="id" value={u.id} />
                <Button type="submit" variant="ghost" size="sm" className="text-red-500 hover:text-red-700">
                  <Trash2 size={12} />
                </Button>
              </form>
            </div>
            {render(u.id, depth + 1)}
          </li>
        ))}
      </ul>
    )
  }

  if (units.length === 0) {
    return <p className="text-sm text-slate-500">No org units yet.</p>
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
        <CardTitle className="text-base">{title} ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50">
                <span>{i.name}</span>
                <form action={deleteAction} className="inline">
                  <input type="hidden" name="id" value={i.id} />
                  <Button type="submit" variant="ghost" size="sm" className="text-red-500 hover:text-red-700">
                    <Trash2 size={12} />
                  </Button>
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

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}
