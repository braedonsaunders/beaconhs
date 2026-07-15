import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_193c5c1cb110b3') }
}
export const dynamic = 'force-dynamic'

const KIND_FILTER_OPTIONS = OBLIGATION_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))
const BASE = '/compliance/obligations'

export default async function ObligationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_1b97e9ccfe9667')}
            description={tGenerated('m_146371a6a81e59')}
            actions={
              canAssign ? (
                <Link href="/compliance/obligations/new">
                  <Button>
                    <GeneratedText id="m_01ea7b508d9390" />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <ComplianceSubNav active="obligations" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_16e4ca6d191db6')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="kind"
              label={tGenerated('m_1e578efe1574cd')}
              options={KIND_FILTER_OPTIONS}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          total === 0 && !hasFilters ? (
            <EmptyState
              icon={<ListChecks size={32} />}
              title={tGenerated('m_0a25a9112d2079')}
              description={tGenerated('m_116b2fdc6cce4f')}
              action={
                canAssign ? (
                  <Link href="/compliance/obligations/new">
                    <Button>
                      <GeneratedText id="m_01ea7b508d9390" />
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
              <GeneratedText id="m_097c83cbd088ee" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <GeneratedText id="m_1e578efe1574cd" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0decefd558c355" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_1d6e21e94d2295" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_1151ed0308b6d1" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((r) => (
                      <TableRow key={`${r.kind}:${r.id}`}>
                        <TableCell>
                          <Badge variant="secondary">
                            <GeneratedValue value={kindLabel(r.kind)} />
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/compliance/obligations/${r.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={r.title} />
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={r.audience} />
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={r.cadence} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.enabled ? 'success' : 'secondary'}>
                            <GeneratedValue
                              value={
                                r.enabled ? (
                                  <GeneratedText id="m_1e1b1fdb7dd78e" />
                                ) : (
                                  <GeneratedText id="m_0ea7ffe3f671e7" />
                                )
                              }
                            />
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  />
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
          )
        }
      />
    </ListPageLayout>
  )
}
