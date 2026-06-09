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
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { ComplianceSubNav } from '../_sub-nav'
import { listObligations } from './_data'
import { OBLIGATION_KINDS, type ObligationKind, kindLabel } from './_meta'

export const metadata = { title: 'Compliance · Obligations' }
export const dynamic = 'force-dynamic'

const KIND_FILTER_OPTIONS = OBLIGATION_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))

export default async function ObligationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()
  const rawKind = pickString(sp.kind)
  const kindFilter = OBLIGATION_KINDS.includes(rawKind as ObligationKind)
    ? (rawKind as ObligationKind)
    : undefined

  const rows = await listObligations(ctx, kindFilter)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Obligations"
            description="Every recurring assignment, across every kind, in one place. Create, audience, and cadence — managed here."
            actions={
              <Link href="/compliance/obligations/new">
                <Button>New obligation</Button>
              </Link>
            }
          />
          <ComplianceSubNav active="obligations" />
          <FilterChips
            basePath="/compliance/obligations"
            currentParams={sp}
            paramKey="kind"
            label="Kind"
            options={KIND_FILTER_OPTIONS}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={32} />}
          title={kindFilter ? `No ${kindLabel(kindFilter).toLowerCase()} obligations yet` : 'No obligations yet'}
          description="Create a recurring obligation so the right people complete the right thing on cadence."
          action={
            <Link href="/compliance/obligations/new">
              <Button>New obligation</Button>
            </Link>
          }
        />
      ) : (
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
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {r.title}
                  </Link>
                </TableCell>
                <TableCell className="text-xs text-slate-600">{r.audience}</TableCell>
                <TableCell className="text-xs text-slate-600">{r.cadence}</TableCell>
                <TableCell>
                  <Badge variant={r.enabled ? 'success' : 'secondary'}>
                    {r.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
