// Org chart — renders the reports-to hierarchy as an indented vertical tree.
//
// Each manager_person_id link becomes a parent → child edge. Top-level nodes
// (no manager) are roots. We accept ?root=<personId> to show only that
// person's subtree.
//
// Implementation notes:
//   • We fetch everyone in one query, then build the tree in-memory. Cheap
//     even for tenants with thousands of people because we only carry a
//     handful of fields per row.
//   • A simple visited-set cycle guard prevents infinite recursion if the
//     data is ever inconsistent (e.g. A reports to B reports to A). The
//     person-edit form only blocks self-reference; longer cycles are not
//     prevented at write time.
//   • Collapse/expand is pure HTML <details> — no JS, no client component.

import Link from 'next/link'
import { and, eq, isNull, asc } from 'drizzle-orm'
import { Users } from 'lucide-react'
import { Badge, Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { people, personTitleAssignments, personTitles } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from '../_components/people-sub-nav'
import { TreeNode, type OrgNode } from './_tree-node'

export const metadata = { title: 'Org chart' }
export const dynamic = 'force-dynamic'

export default async function OrgChartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const rootParam = typeof sp.root === 'string' ? sp.root : null

  const ctx = await requireModuleManage('people')
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: personTitles.name,
        managerPersonId: people.managerPersonId,
      })
      .from(people)
      .leftJoin(
        personTitleAssignments,
        and(
          eq(personTitleAssignments.personId, people.id),
          eq(personTitleAssignments.isPrimary, true),
        ),
      )
      .leftJoin(
        personTitles,
        and(eq(personTitles.id, personTitleAssignments.titleId), isNull(personTitles.deletedAt)),
      )
      .where(and(isNull(people.deletedAt), eq(people.status, 'active')))
      .orderBy(asc(people.lastName), asc(people.firstName)),
  )

  // Build the tree.
  const byId = new Map<string, OrgNode>()
  for (const r of rows) {
    byId.set(r.id, { ...r, reports: [] })
  }
  for (const node of byId.values()) {
    if (node.managerPersonId) {
      const parent = byId.get(node.managerPersonId)
      if (parent) parent.reports.push(node)
    }
  }

  // Determine roots.
  let roots: OrgNode[]
  if (rootParam && byId.has(rootParam)) {
    roots = [byId.get(rootParam)!]
  } else {
    roots = Array.from(byId.values()).filter(
      (n) => !n.managerPersonId || !byId.has(n.managerPersonId),
    )
    // People in a manager cycle (A reports to B, B reports to A) all have a
    // manager that exists, so none qualifies as a root and the whole cycle —
    // plus everyone under it — would silently vanish from the chart. Promote
    // one representative per unreachable cluster to a flagged top-level node.
    const reachable = new Set<string>()
    const visit = (n: OrgNode): void => {
      if (reachable.has(n.id)) return
      reachable.add(n.id)
      for (const r of n.reports) visit(r)
    }
    for (const r of roots) visit(r)
    for (const n of byId.values()) {
      if (!reachable.has(n.id)) {
        n.inCycle = true
        roots.push(n)
        visit(n)
      }
    }
  }

  const totalPeople = rows.length
  const orphanCount = rows.filter((r) => r.managerPersonId === null).length

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active="org-chart" />
          <PageHeader
            title="Org chart"
            description="Reporting structure built from the manager assigned on each person. Edit a person to change who they report to."
            actions={
              rootParam ? (
                <Link href="/people/org-chart">
                  <Button variant="outline">View full chart</Button>
                </Link>
              ) : null
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge variant="secondary">{totalPeople} people</Badge>
            <Badge variant="secondary">{orphanCount} top-level</Badge>
            {rootParam ? <Badge variant="warning">Subtree view</Badge> : null}
          </div>
        </>
      }
    >
      {roots.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No people to chart"
          description="Add a person and assign their manager to start building the org tree."
          action={
            <Link href="/people/new">
              <Button>Add a person</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {roots.map((r) => (
            <TreeNode key={r.id} node={r} depth={0} />
          ))}
        </div>
      )}
    </ListPageLayout>
  )
}
