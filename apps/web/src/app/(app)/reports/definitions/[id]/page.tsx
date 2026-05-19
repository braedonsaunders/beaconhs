import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  reportRuns,
  reportSchedules,
  type ReportCustomQuery,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDefinitionById } from '../../_definitions'
import { runOnceFromDefinition, deleteDefinition } from './actions'
import { StatusBadge, formatDateTime } from '../../page'

export const metadata = { title: 'Report definition' }
export const dynamic = 'force-dynamic'

export default async function DefinitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()

  // Recent schedules / runs that point at this definition.
  const [scheduleRows, runRows] = await ctx.db(async (tx) => {
    const s = await tx
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.definitionId, id))
    if (s.length === 0) return [s, []] as const
    const scheduleIds = s.map((row) => row.id)
    const r = await tx
      .select()
      .from(reportRuns)
      .where(eq(reportRuns.scheduleId, scheduleIds[0]!))
      .orderBy(desc(reportRuns.startedAt))
      .limit(20)
    return [s, r] as const
  })

  const isCustom = definition.kind === 'custom'
  const runBound = runOnceFromDefinition.bind(null, id)
  const deleteBound = deleteDefinition.bind(null, id)

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/reports/definitions', label: 'Back to definitions' }}
          title={definition.name}
          subtitle={definition.description ?? `Slug: ${definition.slug}`}
          badge={
            <div className="flex items-center gap-1.5">
              {definition.kind === 'custom' ? (
                <Badge variant="secondary">custom</Badge>
              ) : (
                <Badge variant="outline">built-in</Badge>
              )}
              {definition.category ? (
                <Badge variant="outline">{definition.category.replace(/_/g, ' ')}</Badge>
              ) : null}
            </div>
          }
          actions={
            <>
              <Link href={`/reports/schedules/new?definitionId=${definition.id}`}>
                <Button variant="outline">Subscribe</Button>
              </Link>
              <Link href={`/reports/definitions/new?from=${definition.id}` as any}>
                <Button variant="outline">Clone as custom</Button>
              </Link>
              <form action={runBound}>
                <Button type="submit">Run now</Button>
              </form>
              {isCustom ? (
                <form action={deleteBound}>
                  <Button type="submit" variant="destructive">
                    Delete
                  </Button>
                </form>
              ) : null}
            </>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Detail label="Slug">
                <span className="font-mono text-xs">{definition.slug}</span>
              </Detail>
              <Detail label="Query kind">
                <span className="font-mono text-xs">{definition.queryKind}</span>
              </Detail>
              <Detail label="Created">
                {new Date(definition.createdAt).toLocaleString()}
              </Detail>
              <Detail label="Updated">
                {new Date(definition.updatedAt).toLocaleString()}
              </Detail>
            </dl>
            {isCustom ? (
              <div className="mt-4 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Custom query plan
                </h3>
                <CustomQuerySummary q={definition.customQuery ?? null} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Subscriptions ({scheduleRows.length}) and recent runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scheduleRows.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nobody on this tenant has subscribed yet.{' '}
                <Link
                  href={`/reports/schedules/new?definitionId=${definition.id}`}
                  className="text-teal-700 hover:underline"
                >
                  Create the first schedule.
                </Link>
              </p>
            ) : (
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Cadence</TableHead>
                      <TableHead>Next run</TableHead>
                      <TableHead>Last run</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scheduleRows.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Link
                            href={`/reports/schedules/${s.id}`}
                            className="hover:underline"
                          >
                            {s.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600">{s.cadence}</TableCell>
                        <TableCell className="text-slate-600">
                          {s.nextRunAt ? formatDateTime(s.nextRunAt) : '—'}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {s.lastRunAt ? formatDateTime(s.lastRunAt) : 'never'}
                        </TableCell>
                        <TableCell>
                          {s.active ? (
                            <Badge variant="success">active</Badge>
                          ) : (
                            <Badge variant="secondary">paused</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {runRows.length > 0 ? (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Recent runs (latest schedule)
                    </h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Started</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Rows</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {runRows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>
                              <Link
                                href={`/reports/schedules/${r.scheduleId}/runs/${r.id}`}
                                className="hover:underline"
                              >
                                {formatDateTime(r.startedAt)}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={r.status} />
                            </TableCell>
                            <TableCell className="text-slate-600">
                              {r.rowCount ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  )
}

function CustomQuerySummary({ q }: { q: ReportCustomQuery | null }) {
  if (!q) return <p className="text-sm text-slate-500">No query plan stored.</p>
  return (
    <div className="space-y-2 text-sm">
      <div>
        <span className="font-medium text-slate-700">Entity: </span>
        <span className="font-mono text-xs">{q.entity}</span>
      </div>
      <div>
        <span className="font-medium text-slate-700">Columns: </span>
        <span className="font-mono text-xs">{q.columns.join(', ')}</span>
      </div>
      {q.filters && q.filters.length > 0 ? (
        <div>
          <span className="font-medium text-slate-700">Filters:</span>
          <ul className="ml-4 list-disc text-xs text-slate-600">
            {q.filters.map((f, i) => (
              <li key={i} className="font-mono">
                {f.column} {f.op}{' '}
                {f.value !== null && typeof f.value !== 'undefined'
                  ? JSON.stringify(f.value)
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {q.groupBy ? (
        <div>
          <span className="font-medium text-slate-700">Group by: </span>
          <span className="font-mono text-xs">{q.groupBy}</span>
        </div>
      ) : null}
      {q.sort ? (
        <div>
          <span className="font-medium text-slate-700">Sort: </span>
          <span className="font-mono text-xs">
            {q.sort.column} {q.sort.direction}
          </span>
        </div>
      ) : null}
      <div>
        <span className="font-medium text-slate-700">Row limit: </span>
        <span className="font-mono text-xs">{q.limit ?? 1000}</span>
      </div>
    </div>
  )
}
