import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1511890758f272') }
}

const SORTS = ['count', 'name'] as const

export default async function FormTranscriptsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_1511890758f272')}
            description={tGenerated('m_1dfcd0a31b8026')}
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1dc5c4814dcbf4')} />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Users size={32} />}
              title={tGeneratedValue(
                params.q ? tGenerated('m_0ea3b72e73dcee') : tGenerated('m_14368fc8801c5b'),
              )}
              description={tGeneratedValue(
                params.q ? tGenerated('m_01af17e02658c6') : tGenerated('m_008edc7bbeab62'),
              )}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      <GeneratedText id="m_12e926c9216094" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="count"
                      active={params.sort === 'count'}
                      align="right"
                      className="text-right"
                    >
                      <GeneratedText id="m_110d914ff13ded" />
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((r) => (
                      <TableRow key={r.personId}>
                        <TableCell>
                          <Link
                            href={`/apps/transcripts/${r.personId}`}
                            className="font-medium hover:underline"
                          >
                            <GeneratedValue value={r.name} />
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">
                            <GeneratedValue value={r.count} />
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  />
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
          )
        }
      />
    </ListPageLayout>
  )
}
