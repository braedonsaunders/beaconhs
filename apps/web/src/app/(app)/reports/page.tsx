import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import {
  Badge,
  Button,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { GeneratedText } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { loadVisibleDefinitions } from './_definitions'
import { ReportsSubNav } from './_nav'

export const dynamic = 'force-dynamic'
const PER_PAGE = 25

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.trim().toLowerCase() : ''
  const category = typeof params.category === 'string' ? params.category : ''
  const page = Math.max(1, Number(typeof params.page === 'string' ? params.page : 1) || 1)
  const definitions = await loadVisibleDefinitions(ctx.tenantId!)
  const categories = [...new Set(definitions.map((definition) => definition.category))].sort()
  const filtered = definitions.filter(
    (definition) =>
      (!category || definition.category === category) &&
      (!query ||
        `${definition.name} ${definition.description ?? ''} ${definition.category}`
          .toLowerCase()
          .includes(query)),
  )
  const rows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const canBuild = ctx.isSuperAdmin || can(ctx, 'reports.builder')

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_09bb00824b733b')}
            description={tGenerated('m_0f7946011d7d13')}
            actions={
              canBuild ? (
                <Button asChild>
                  <Link href="/reports/definitions/new">
                    <Plus size={15} />
                    <GeneratedText id="m_084b76c7fa79df" />
                  </Link>
                </Button>
              ) : null
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <ReportsSubNav active="reports" />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <SearchInput placeholder={tGenerated('m_0224c155374ff8')} />
              <FilterChips
                basePath="/reports"
                currentParams={params}
                paramKey="category"
                label={tGenerated('m_108b41637f364f')}
                options={categories.map((value) => ({
                  value,
                  label: value.replaceAll('_', ' '),
                }))}
              />
            </div>
          </div>
        </>
      }
    >
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <GeneratedText id="m_0ab5a972fc80fd" />
              </TableHead>
              <TableHead>
                <GeneratedText id="m_1d05fa7a091a9b" />
              </TableHead>
              <TableHead>
                <GeneratedText id="m_108b41637f364f" />
              </TableHead>
              <TableHead>
                <GeneratedText id="m_014ca61c68ab13" />
              </TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((definition) => (
                <TableRow key={definition.id}>
                  <TableCell>
                    <Link
                      href={`/reports/definitions/${definition.id}`}
                      className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                    >
                      {definition.name}
                    </Link>
                    {definition.description ? (
                      <p className="mt-1 max-w-3xl text-xs text-slate-500">
                        {definition.description}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>{definition.query.entity.replaceAll('_', ' ')}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{definition.category.replaceAll('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell>{definition.updatedAt.toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/reports/definitions/${definition.id}`}>
                        <GeneratedText id="m_107ab58c3c38bc" />
                        <ArrowRight size={14} />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                  <GeneratedText id="m_1841d2703b10cc" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <Pagination
          basePath="/reports"
          currentParams={params}
          total={filtered.length}
          page={page}
          perPage={PER_PAGE}
        />
      </div>
    </ListPageLayout>
  )
}
