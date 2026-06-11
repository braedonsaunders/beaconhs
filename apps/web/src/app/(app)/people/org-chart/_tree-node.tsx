'use client'

// Recursive org-chart node. MUST be a client component: the in-summary links
// use onClick={stopPropagation} so clicking a person/Focus link doesn't also
// toggle the surrounding <details>. Event handlers are illegal in Server
// Components — rendering this from the (server) page with onClick props throws
// "Event handlers cannot be passed to Client Component props", which previously
// broke the whole org-chart route (and froze App Router navigation) as soon as
// a tenant had any people.

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@beaconhs/ui'

export type OrgNode = {
  id: string
  firstName: string
  lastName: string
  jobTitle: string | null
  managerPersonId: string | null
  reports: OrgNode[]
}

export function TreeNode({
  node,
  depth,
  seen = new Set<string>(),
}: {
  node: OrgNode
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
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/30">
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
            {node.jobTitle ? <span className="text-xs text-slate-500">{node.jobTitle}</span> : null}
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
