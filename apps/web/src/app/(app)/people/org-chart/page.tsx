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
import { isNull, asc } from 'drizzle-orm'
import { ChevronRight, Users } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
} from '@beaconhs/ui'
import { people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from '../_components/people-sub-nav'

export const metadata = { title: 'Org chart' }
export const dynamic = 'force-dynamic'

type Node = {
  id: string
  firstName: string
  lastName: string
  jobTitle: string | null
  managerPersonId: string | null
  reports: Node[]
}

export default async function OrgChartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const rootParam = typeof sp.root === 'string' ? sp.root : null

  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: people.jobTitle,
        managerPersonId: people.managerPersonId,
      })
      .from(people)
      .where(isNull(people.deletedAt))
      .orderBy(asc(people.lastName), asc(people.firstName)),
  )

  // Build the tree.
  const byId = new Map<string, Node>()
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
  let roots: Node[]
  if (rootParam && byId.has(rootParam)) {
    roots = [byId.get(rootParam)!]
  } else {
    roots = Array.from(byId.values()).filter(
      (n) => !n.managerPersonId || !byId.has(n.managerPersonId),
    )
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
            {rootParam ? (
              <Badge variant="warning">Subtree view</Badge>
            ) : null}
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

function TreeNode({
  node,
  depth,
  seen = new Set<string>(),
}: {
  node: Node
  depth: number
  seen?: Set<string>
}) {
  // In-memory cycle guard — if we somehow reach the same id twice we bail
  // rather than recurse forever.
  if (seen.has(node.id)) return null
  const nextSeen = new Set(seen)
  nextSeen.add(node.id)

  const hasReports = node.reports.length > 0
  // <details open> by default for the top few levels; collapse deeper layers.
  const openByDefault = depth < 1

  return (
    <details
      open={openByDefault}
      className="group"
      style={{ marginLeft: depth === 0 ? 0 : '1.5rem' }}
    >
      <summary
        className={
          'flex cursor-pointer list-none items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/30'
        }
      >
        <ChevronRight
          size={14}
          className={
            'text-slate-400 transition-transform group-open:rotate-90 ' +
            (hasReports ? '' : 'invisible')
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={`/people/${node.id}`}
              className="font-medium text-slate-900 hover:text-teal-700 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {node.firstName} {node.lastName}
            </Link>
            {node.jobTitle ? (
              <span className="text-xs text-slate-500">{node.jobTitle}</span>
            ) : null}
          </div>
        </div>
        {hasReports ? (
          <Badge variant="secondary">
            {node.reports.length} report{node.reports.length === 1 ? '' : 's'}
          </Badge>
        ) : null}
        <Link
          href={`/people/org-chart?root=${node.id}`}
          className="rounded px-1.5 py-0.5 text-[11px] text-teal-700 hover:bg-teal-50 hover:underline"
          onClick={(e) => e.stopPropagation()}
          title="Focus on this person's subtree"
        >
          Focus
        </Link>
      </summary>
      {hasReports ? (
        <div className="mt-1 space-y-1 border-l border-slate-200 pl-3">
          {node.reports.map((r) => (
            <TreeNode key={r.id} node={r} depth={depth + 1} seen={nextSeen} />
          ))}
        </div>
      ) : null}
    </details>
  )
}
