import Link from 'next/link'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { ListChecks } from 'lucide-react'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { Pagination } from '@/components/pagination'
import { ComplianceSubNav } from '../_sub-nav'
import { listObligations } from './_data'
import { OBLIGATION_KINDS, type ObligationKind, kindLabel } from './_meta'

export const metadata = { title: 'Compliance · Obligations' }
export const dynamic = 'force-dynamic'

const KIND_FILTER_OPTIONS = OBLIGATION_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))
const BASE = '/compliance/obligations'

export default async function ObligationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const canAssign = can(ctx, 'compliance.assign')
  const params = parseListParams(sp, {
    sort: 'created',
    allowedSorts: ['created'] as const,
    perPage: 25,
  })
  const rawKind = pickString(sp.kind)
  const kindFilter = OBLIGATION_KINDS.includes(rawKind as ObligationKind)
    ? (rawKind as ObligationKind)
    : undefined

  const { rows, total } = await listObligations(ctx, {
    kind: kindFilter,
    q: params.q,
    page: params.page,
    perPage: params.perPage,
  })
  const hasFilters = Boolean(params.q || kindFilter)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Obligations"
            description="All recurring obligations in one place — kind, audience, and cadence."
            actions={
              canAssign ? (
                <Link href="/compliance/obligations/new">
                  <Button>New obligation</Button>
                </Link>
              ) : undefined
            }
          />
          <ComplianceSubNav active="obligations" />
          <TableToolbar>
            <SearchInput placeholder="Search obligations by title…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="kind"
              label="Kind"
              options={KIND_FILTER_OPTIONS}
            />
          </TableToolbar>
        </>
      }
    >
      {total === 0 && !hasFilters ? (
        <EmptyState
          icon={<ListChecks size={32} />}
          title="No obligations"
          description="Create a recurring obligation to assign required work on a schedule."
          action={
            canAssign ? (
              <Link href="/compliance/obligations/new">
                <Button>New obligation</Button>
              </Link>
            ) : undefined
          }
        />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
          No obligations match your search or filter.
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.kind}:${r.id}`}>
                  <TableCell>
                    <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/compliance/obligations/${r.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                    {r.audience}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                    {r.cadence}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.enabled ? 'success' : 'secondary'}>
                      {r.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath={BASE}
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
