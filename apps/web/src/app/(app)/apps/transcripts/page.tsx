import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Users } from 'lucide-react'
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { SortableTh } from '@/components/sortable-th'
import { parseListParams } from '@/lib/list-params'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { listTranscriptPeople } from '../_lib/participants'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Form transcripts' }

const SORTS = ['count', 'name'] as const

export default async function FormTranscriptsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'count',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireRequestContext()
  // Transcripts are inherently cross-record (every person's full form history),
  // so they require the reviewer read tier. Workers see their own history via
  // their workspace, not this admin surface.
  if (!can(ctx, 'forms.response.read.all')) notFound()
  const { rows, total } = await listTranscriptPeople(ctx, {
    q: params.q,
    sort: params.sort,
    dir: params.dir,
    page: params.page,
    perPage: params.perPage,
  })
  const sortProps = { basePath: '/apps/transcripts', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Form transcripts"
            description="Per-person history: every form a person was a participant in or signed."
          />
          <TableToolbar>
            <SearchInput placeholder="Search by name…" />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title={params.q ? 'No participants match this search' : 'No participants'}
          description={
            params.q
              ? 'Clear or change the current name search.'
              : 'Submit a form with an attendees section or a person field to build transcripts.'
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Person
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="count"
                  active={params.sort === 'count'}
                  align="right"
                  className="text-right"
                >
                  Forms participated in
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.personId}>
                  <TableCell>
                    <Link
                      href={`/apps/transcripts/${r.personId}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{r.count}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/apps/transcripts"
            currentParams={sp}
            total={total}
            page={Math.min(params.page, Math.max(1, Math.ceil(total / params.perPage)))}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
