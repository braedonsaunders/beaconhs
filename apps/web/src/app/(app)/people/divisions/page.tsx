import Link from 'next/link'
import { ChevronRight, Layers } from 'lucide-react'
import { asc, count } from 'drizzle-orm'
import { Badge, Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { personDivisionMemberships, personDivisions } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from '../_components/people-sub-nav'

export const metadata = { title: 'People — Divisions' }
export const dynamic = 'force-dynamic'

type DivisionRow = typeof personDivisions.$inferSelect & { memberCount: number }

export default async function DivisionsPage() {
  const ctx = await requireModuleManage('people')
  const rows = await ctx.db(async (tx) => {
    const all = await tx.select().from(personDivisions).orderBy(asc(personDivisions.name))
    const counts = await tx
      .select({
        divisionId: personDivisionMemberships.divisionId,
        c: count(),
      })
      .from(personDivisionMemberships)
      .groupBy(personDivisionMemberships.divisionId)
    const countsById = new Map(counts.map((c) => [c.divisionId, Number(c.c)]))
    return all.map((d) => ({ ...d, memberCount: countsById.get(d.id) ?? 0 }) as DivisionRow)
  })

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active="divisions" />
          <PageHeader
            title="Divisions"
            description="Hierarchical business taxonomy (Construction → Civil → Earthworks). One person can sit in many divisions."
            actions={
              <Link href="/people/divisions/new">
                <Button>Add division</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Layers size={32} />}
          title="No divisions"
          description="Divisions segment the workforce by trade-line rather than site, for matrix reporting."
          action={
            <Link href="/people/divisions/new">
              <Button>New division</Button>
            </Link>
          }
        />
      ) : (
        <DivisionTree rows={rows} />
      )}
    </ListPageLayout>
  )
}

function DivisionTree({ rows }: { rows: DivisionRow[] }) {
  const byParent = new Map<string | null, DivisionRow[]>()
  for (const r of rows) {
    const k = r.parentDivisionId
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(r)
  }

  function render(parentId: string | null, depth: number): React.ReactNode {
    const children = byParent.get(parentId) ?? []
    if (children.length === 0) return null
    return (
      <ul className={depth === 0 ? 'space-y-1' : 'ml-5 space-y-1 border-l border-slate-200 pl-3'}>
        {children.map((d) => (
          <li key={d.id}>
            <Link
              href={`/people/divisions/${d.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                <ChevronRight size={14} className="text-slate-400" />
                <span className="font-medium text-slate-900">{d.name}</span>
                {d.code ? <span className="font-mono text-xs text-slate-500">{d.code}</span> : null}
              </span>
              <span className="flex items-center gap-3 text-xs text-slate-500">
                {d.description ? (
                  <span className="hidden max-w-md truncate sm:inline">{d.description}</span>
                ) : null}
                <Badge variant="secondary">{d.memberCount}</Badge>
              </span>
            </Link>
            {render(d.id, depth + 1)}
          </li>
        ))}
      </ul>
    )
  }

  return render(null, 0)
}
