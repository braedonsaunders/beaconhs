import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Users } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
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
import { parseListParams, pickString } from '@/lib/list-params'
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
  const rawQ = pickString(sp.q) ?? ''
  const q = rawQ.trim().toLowerCase()
  const params = parseListParams(sp, { sort: 'count', dir: 'desc', allowedSorts: SORTS })
  const ctx = await requireRequestContext()
  // Transcripts are inherently cross-record (every person's full form history),
  // so they require the reviewer read tier. Workers see their own history via
  // their workspace, not this admin surface.
  if (!can(ctx, 'forms.response.read.all')) notFound()
  const all = await listTranscriptPeople(ctx)
  const rows = (q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all).sort((a, b) => {
    const cmp =
      params.sort === 'name'
        ? a.name.localeCompare(b.name)
        : a.count - b.count || a.name.localeCompare(b.name)
    return params.dir === 'asc' ? cmp : -cmp
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
          <form className="flex items-center gap-2" action="/apps/transcripts" method="get">
            <Input
              name="q"
              type="search"
              placeholder="Search by name…"
              defaultValue={rawQ}
              className="max-w-sm"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No participants"
          description="Submit a form with an attendees section or a person field to build transcripts."
        />
      ) : (
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
      )}
    </ListPageLayout>
  )
}
