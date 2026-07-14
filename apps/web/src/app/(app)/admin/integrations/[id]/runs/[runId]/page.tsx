import { SmartBackLink } from '@/components/smart-back-link'
import { notFound, redirect } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import {
  type SyncEntityStat,
  type SyncEntityKey,
  type SyncRecordAction,
  type SyncRecordDiff,
  syncConnections,
  syncRecordChanges,
  syncRuns,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { PageContainer } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'

export const metadata = { title: 'Sync run' }
export const dynamic = 'force-dynamic'

const ACTION_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  created: 'default',
  updated: 'secondary',
  unchanged: 'outline',
  skipped: 'outline',
  archived: 'destructive',
  failed: 'destructive',
  conflict: 'destructive',
}

const ENTITY_LABELS: Record<string, string> = {
  people: 'People',
  org_unit: 'Locations & Projects',
  equipment: 'Equipment',
  contact: 'Contacts',
}

const SORTS = ['created', 'action', 'entity', 'external'] as const
const ACTIONS = Object.keys(ACTION_VARIANT) as SyncRecordAction[]
const ENTITIES = Object.keys(ENTITY_LABELS) as SyncEntityKey[]

function diffSummary(diff: SyncRecordDiff | null): string {
  if (!diff || Object.keys(diff).length === 0) return 'No field changes'
  const keys = Object.keys(diff)
  const shown = keys.slice(0, 4).join(', ')
  return keys.length > 4 ? `${shown}, +${keys.length - 4} more` : shown
}

function statText(stats: Record<string, SyncEntityStat>): string {
  const parts: string[] = []
  for (const [entity, stat] of Object.entries(stats ?? {})) {
    parts.push(
      `${ENTITY_LABELS[entity] ?? entity}: ${stat.created ?? 0} created, ${stat.updated ?? 0} updated, ${stat.unchanged ?? 0} unchanged, ${stat.conflict ?? 0} conflicts, ${stat.failed ?? 0} failed`,
    )
  }
  return parts.join(' · ') || 'No records'
}

export default async function SyncRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; runId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id, runId } = await params
  if (!isUuid(id) || !isUuid(runId)) notFound()

  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'created',
    dir: 'desc',
    perPage: 50,
    allowedSorts: SORTS,
  })
  const actionParam = pickString(sp.action)
  const actionFilter = ACTIONS.find((action) => action === actionParam)
  const entityParam = pickString(sp.entity)
  const entityFilter = ENTITIES.find((entity) => entity === entityParam)
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.integrations.manage')) redirect('/admin')

  const data = await ctx.db(async (tx) => {
    const [conn] = await tx
      .select({
        id: syncConnections.id,
        name: syncConnections.name,
        connectorKey: syncConnections.connectorKey,
      })
      .from(syncConnections)
      .where(and(eq(syncConnections.id, id), isNull(syncConnections.deletedAt)))
      .limit(1)
    const [run] = await tx
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.id, runId), eq(syncRuns.connectionId, id)))
      .limit(1)
    if (!conn || !run) return null
    const search: SQL<unknown> | undefined = listParams.q
      ? or(
          ilike(syncRecordChanges.externalId, `%${listParams.q}%`),
          ilike(syncRecordChanges.message, `%${listParams.q}%`),
          ilike(syncRecordChanges.entity, `%${listParams.q}%`),
          sql`${syncRecordChanges.canonicalId}::text ilike ${`%${listParams.q}%`}`,
        )
      : undefined
    const where = and(
      eq(syncRecordChanges.runId, runId),
      search,
      actionFilter ? eq(syncRecordChanges.action, actionFilter) : undefined,
      entityFilter ? eq(syncRecordChanges.entity, entityFilter) : undefined,
    )
    const dirFn = listParams.dir === 'asc' ? asc : desc
    const orderBy =
      listParams.sort === 'action'
        ? [dirFn(syncRecordChanges.action), desc(syncRecordChanges.createdAt)]
        : listParams.sort === 'entity'
          ? [dirFn(syncRecordChanges.entity), desc(syncRecordChanges.createdAt)]
          : listParams.sort === 'external'
            ? [dirFn(syncRecordChanges.externalId), desc(syncRecordChanges.createdAt)]
            : [dirFn(syncRecordChanges.createdAt)]
    const [totalRow, actionRows, entityRows, changes] = await Promise.all([
      tx.select({ c: count() }).from(syncRecordChanges).where(where),
      tx
        .select({ action: syncRecordChanges.action, c: count() })
        .from(syncRecordChanges)
        .where(
          and(
            eq(syncRecordChanges.runId, runId),
            search,
            entityFilter ? eq(syncRecordChanges.entity, entityFilter) : undefined,
          ),
        )
        .groupBy(syncRecordChanges.action),
      tx
        .select({ entity: syncRecordChanges.entity, c: count() })
        .from(syncRecordChanges)
        .where(
          and(
            eq(syncRecordChanges.runId, runId),
            search,
            actionFilter ? eq(syncRecordChanges.action, actionFilter) : undefined,
          ),
        )
        .groupBy(syncRecordChanges.entity),
      tx
        .select()
        .from(syncRecordChanges)
        .where(where)
        .orderBy(...orderBy)
        .limit(listParams.perPage)
        .offset((listParams.page - 1) * listParams.perPage),
    ])
    return {
      conn,
      run,
      changes,
      total: Number(totalRow[0]?.c ?? 0),
      actionCounts: Object.fromEntries(actionRows.map((row) => [row.action, Number(row.c)])),
      entityCounts: Object.fromEntries(entityRows.map((row) => [row.entity, Number(row.c)])),
    }
  })

  if (!data) notFound()

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="space-y-1">
          <SmartBackLink
            href={`/admin/integrations/${data.conn.id}`}
            label={data.conn.name}
            className="text-xs text-slate-400 hover:text-slate-600"
          />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Sync run review
            </h1>
            <Badge variant={data.run.status === 'success' ? 'secondary' : 'destructive'}>
              {data.run.status}
            </Badge>
            {data.run.dryRun ? <Badge variant="outline">preview</Badge> : null}
          </div>
          <p className="text-sm text-slate-500">
            {formatDateTime(new Date(data.run.startedAt), ctx.timezone, ctx.locale)} ·{' '}
            {data.run.trigger} ·{' '}
            {data.run.durationMs != null
              ? `${(data.run.durationMs / 1000).toFixed(1)}s`
              : 'running'}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <p>{statText(data.run.stats)}</p>
            {data.run.error ? <p className="text-red-600">{data.run.error}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record decisions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <TableToolbar>
              <SearchInput placeholder="Search IDs, entity, or message…" />
              <FilterChips
                basePath={`/admin/integrations/${data.conn.id}/runs/${runId}`}
                currentParams={sp}
                paramKey="action"
                label="Action"
                options={ACTIONS.map((action) => ({
                  value: action,
                  label: action,
                  count: data.actionCounts[action] ?? 0,
                }))}
              />
              <FilterChips
                basePath={`/admin/integrations/${data.conn.id}/runs/${runId}`}
                currentParams={sp}
                paramKey="entity"
                label="Entity"
                options={ENTITIES.map((entity) => ({
                  value: entity,
                  label: ENTITY_LABELS[entity] ?? entity,
                  count: data.entityCounts[entity] ?? 0,
                }))}
              />
            </TableToolbar>
            {data.changes.length === 0 ? (
              <p className="text-sm text-slate-400">
                {listParams.q || actionFilter || entityFilter
                  ? 'No row decisions match the search or filters.'
                  : 'This run has no recorded row decisions.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTh
                        basePath={`/admin/integrations/${data.conn.id}/runs/${runId}`}
                        currentParams={sp}
                        dir={listParams.dir}
                        column="action"
                        active={listParams.sort === 'action'}
                      >
                        Action
                      </SortableTh>
                      <SortableTh
                        basePath={`/admin/integrations/${data.conn.id}/runs/${runId}`}
                        currentParams={sp}
                        dir={listParams.dir}
                        column="entity"
                        active={listParams.sort === 'entity'}
                      >
                        Entity
                      </SortableTh>
                      <SortableTh
                        basePath={`/admin/integrations/${data.conn.id}/runs/${runId}`}
                        currentParams={sp}
                        dir={listParams.dir}
                        column="external"
                        active={listParams.sort === 'external'}
                      >
                        External ID
                      </SortableTh>
                      <TableHead>Canonical row</TableHead>
                      <TableHead>Changed fields</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.changes.map((change) => (
                      <TableRow key={change.id}>
                        <TableCell>
                          <Badge
                            variant={ACTION_VARIANT[change.action] ?? 'outline'}
                            className={cn(change.action === 'unchanged' && 'text-slate-500')}
                          >
                            {change.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-700 dark:text-slate-300">
                          {ENTITY_LABELS[change.entity] ?? change.entity}
                        </TableCell>
                        <TableCell className="max-w-xs truncate font-mono text-xs">
                          {change.externalId}
                        </TableCell>
                        <TableCell className="max-w-xs truncate font-mono text-xs text-slate-500">
                          {change.canonicalId ?? 'not created yet'}
                        </TableCell>
                        <TableCell className="max-w-sm text-xs text-slate-600 dark:text-slate-300">
                          {diffSummary(change.diff)}
                        </TableCell>
                        <TableCell className="max-w-md text-xs text-slate-500">
                          {change.message ?? ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <Pagination
              basePath={`/admin/integrations/${data.conn.id}/runs/${runId}`}
              currentParams={sp}
              total={data.total}
              page={listParams.page}
              perPage={listParams.perPage}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
