import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
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
import { requireRequestContext } from '@/lib/auth'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { Pagination } from '@/components/pagination'
import { obligationOverview, kindLabel } from './_hub'
import { PercentBar } from './_shared'
import { ComplianceSubNav } from './_sub-nav'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_096d47f60747b3') }
}
export const dynamic = 'force-dynamic'

const BASE = '/compliance'

export default async function ComplianceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const ctx = await requireRequestContext()
  // Everyone reaches /compliance from the sidebar; those without the org-wide
  // read permission see only their own obligations.
  if (!can(ctx, 'compliance.read')) redirect('/compliance/mine')
  const canAssign = can(ctx, 'compliance.assign')
  const params = parseListParams(sp, { sort: 'overdue', allowedSorts: ['overdue'] as const })
  const overview = await obligationOverview(ctx, {
    q: params.q,
    page: params.page,
    perPage: params.perPage,
  })

  // KPIs are the org-wide scoreboard — always over every obligation, never the
  // searched/paged subset.
  const totalSubjects = overview.summary.subjects
  const totalCompleted = overview.summary.completed
  const totalOverdue = overview.summary.overdue
  const overall = totalSubjects === 0 ? 0 : Math.round((totalCompleted / totalSubjects) * 100)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_096d47f60747b3')}
            description={tGenerated('m_15bbf8bb08b939')}
            actions={
              canAssign ? (
                <Link href="/compliance/obligations?drawer=new">
                  <Button>
                    <GeneratedText id="m_01ea7b508d9390" />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <ComplianceSubNav active="overview" />
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label={tGenerated('m_1b97e9ccfe9667')} value={overview.summary.obligations} />
          <Kpi label={tGenerated('m_09db1dfbe5978e')} value={totalSubjects.toLocaleString()} />
          <Kpi
            label={tGenerated('m_09ab077b65d449')}
            value={totalOverdue.toLocaleString()}
            tone={totalOverdue > 0 ? 'danger' : undefined}
            href="/compliance/expiring"
          />
          <Kpi label={tGenerated('m_1de38cbb19aa09')} value={`${overall}%`} />
        </div>

        <TableToolbar>
          <SearchInput placeholder={tGenerated('m_16e4ca6d191db6')} />
        </TableToolbar>

        <GeneratedValue
          value={
            overview.summary.obligations === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                <GeneratedText id="m_0aaf99a65ff870" />
                <GeneratedValue
                  value={
                    canAssign ? (
                      <>
                        <GeneratedValue value={' '} />
                        <Link
                          href="/compliance/obligations?drawer=new"
                          className="text-teal-700 hover:underline"
                        >
                          <GeneratedText id="m_0cf45bbe73ce8b" />
                        </Link>
                        .
                      </>
                    ) : null
                  }
                />
              </div>
            ) : overview.total === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                <GeneratedText id="m_177c81602dd3ec" />
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
                        <GeneratedText id="m_186a52fb889daf" />
                      </TableHead>
                      <TableHead className="w-28">
                        <GeneratedText id="m_0ba7a5e1b2fa32" />
                      </TableHead>
                      <TableHead className="w-28">
                        <GeneratedText id="m_10f84ed2d39730" />
                      </TableHead>
                      <TableHead className="w-28">
                        <GeneratedText id="m_1e40bdcf2d1ba1" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_096d47f60747b3" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={overview.rows.map((r) => (
                        <TableRow key={r.id}>
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
                          <TableCell className="text-slate-700 tabular-nums dark:text-slate-300">
                            <GeneratedValue value={r.completed.toLocaleString()} />
                          </TableCell>
                          <TableCell className="text-slate-700 tabular-nums dark:text-slate-300">
                            <GeneratedValue value={r.total.toLocaleString()} />
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <GeneratedValue
                              value={
                                r.overdue > 0 ? (
                                  <Badge variant="destructive">
                                    <GeneratedValue value={r.overdue} />
                                  </Badge>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="max-w-xs flex-1">
                                <PercentBar percent={r.percent} />
                              </div>
                              <span className="min-w-[3rem] text-right text-xs text-slate-600 tabular-nums dark:text-slate-400">
                                <GeneratedValue value={r.percent} />%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    />
                  </TableBody>
                </Table>
                <Pagination
                  basePath={BASE}
                  currentParams={sp}
                  total={overview.total}
                  page={overview.page}
                  perPage={params.perPage}
                />
              </>
            )
          }
        />
      </div>
    </ListPageLayout>
  )
}

function Kpi({
  label,
  value,
  tone,
  href,
}: {
  label: string
  value: string | number
  tone?: 'danger'
  href?: string
}) {
  const inner = (
    <>
      <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={label} />
      </div>
      <div
        className={`mt-1 text-2xl font-semibold ${tone === 'danger' ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}
      >
        <GeneratedValue value={value} />
      </div>
    </>
  )
  const cls =
    'block rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900'
  if (href) {
    return (
      <Link
        href={href as any}
        className={`${cls} transition-colors hover:border-slate-300 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/60`}
      >
        <GeneratedValue value={inner} />
      </Link>
    )
  }
  return (
    <div className={cls}>
      <GeneratedValue value={inner} />
    </div>
  )
}
