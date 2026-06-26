import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, desc, eq, isNull } from 'drizzle-orm'
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
  type SyncRecordDiff,
  syncConnections,
  syncRecordChanges,
  syncRuns,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

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
}

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
}: {
  params: Promise<{ id: string; runId: string }>
}) {
  const { id, runId } = await params
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
    const changes = await tx
      .select()
      .from(syncRecordChanges)
      .where(eq(syncRecordChanges.runId, runId))
      .orderBy(desc(syncRecordChanges.createdAt))
      .limit(500)
    return { conn, run, changes }
  })

  if (!data) notFound()

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="space-y-1">
          <Link
            href={`/admin/integrations/${data.conn.id}`}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            ← {data.conn.name}
          </Link>
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
            {new Date(data.run.startedAt).toLocaleString()} · {data.run.trigger} ·{' '}
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
          <CardContent>
            {data.changes.length === 0 ? (
              <p className="text-sm text-slate-400">This run has no recorded row decisions.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>External ID</TableHead>
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
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
