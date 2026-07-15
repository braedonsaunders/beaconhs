'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

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
  /** Set when this node was promoted to a root because its manager chain loops. */
  inCycle?: boolean
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
  const tGenerated = useGeneratedTranslations()
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
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/30 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700 dark:hover:bg-teal-950/30">
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
              className="font-medium text-slate-900 hover:text-teal-700 hover:underline dark:text-slate-100 dark:hover:text-teal-400"
              onClick={(e) => e.stopPropagation()}
            >
              <GeneratedValue value={node.firstName} /> <GeneratedValue value={node.lastName} />
            </Link>
            <GeneratedValue
              value={
                node.jobTitle ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={node.jobTitle} />
                  </span>
                ) : null
              }
            />
          </div>
        </div>
        <GeneratedValue
          value={
            node.inCycle ? (
              <Badge variant="warning">
                <GeneratedText id="m_13f12f29889733" />
              </Badge>
            ) : null
          }
        />
        <GeneratedValue
          value={
            hasReports ? (
              <Badge variant="secondary">
                <GeneratedValue value={node.reports.length} />{' '}
                <GeneratedText id="m_109db3d62d40fa" />
                <GeneratedValue
                  value={node.reports.length === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                />
              </Badge>
            ) : null
          }
        />
        <Link
          href={`/people/org-chart?root=${node.id}`}
          className="rounded px-1.5 py-0.5 text-[11px] text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-950"
          onClick={(e) => e.stopPropagation()}
          title={tGenerated('m_1880fb34e8be74')}
        >
          <GeneratedText id="m_00c4a6a789919d" />
        </Link>
      </summary>
      <GeneratedValue
        value={
          hasReports ? (
            <div className="mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-800">
              <GeneratedValue
                value={node.reports.map((r) => (
                  <TreeNode key={r.id} node={r} depth={depth + 1} seen={nextSeen} />
                ))}
              />
            </div>
          ) : null
        }
      />
    </details>
  )
}
