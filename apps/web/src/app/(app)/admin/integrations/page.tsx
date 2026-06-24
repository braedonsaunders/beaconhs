// /admin/integrations — external data-sync connections. Tenants connect a
// source (a SQL database, a CSV, or a SaaS app via Nango) and map it to People,
// Locations and Equipment. Gated by admin.integrations.manage.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowUpRight,
  Building2,
  Database,
  FileSpreadsheet,
  Plus,
  PlugZap,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { desc, isNull } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  cn,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { syncConnections } from '@beaconhs/db/schema'
import { listConnectors, toConnectorSummary } from '@beaconhs/sync'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { AdminBackLink } from '../_back-link'
import { createConnection, deleteConnection } from './_actions'

export const metadata = { title: 'Integrations' }
export const dynamic = 'force-dynamic'

const ICONS: Record<string, LucideIcon> = {
  database: Database,
  'building-2': Building2,
  'file-spreadsheet': FileSpreadsheet,
  'plug-zap': PlugZap,
}

const ENTITY_LABELS: Record<string, string> = {
  people: 'People',
  org_unit: 'Locations & Projects',
  equipment: 'Equipment',
}

const STATUS_PILL: Record<string, string> = {
  connected: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  draft: 'bg-slate-50 text-slate-600 ring-slate-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
  disabled: 'bg-slate-50 text-slate-500 ring-slate-200',
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        STATUS_PILL[status] ?? STATUS_PILL.draft,
      )}
    >
      {status}
    </span>
  )
}

export default async function IntegrationsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.integrations.manage')) redirect('/admin')

  const connectors = listConnectors().map(toConnectorSummary)
  const connections = await ctx.db((tx) =>
    tx
      .select({
        id: syncConnections.id,
        connectorKey: syncConnections.connectorKey,
        name: syncConnections.name,
        status: syncConnections.status,
        enabled: syncConnections.enabled,
        schedule: syncConnections.schedule,
        lastRunAt: syncConnections.lastRunAt,
        lastStatus: syncConnections.lastStatus,
      })
      .from(syncConnections)
      .where(isNull(syncConnections.deletedAt))
      .orderBy(desc(syncConnections.createdAt)),
  )
  const connectorName = (key: string) => connectors.find((c) => c.key === key)?.name ?? key

  return (
    <PageContainer>
      <AdminBackLink />
      <div className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <RefreshCw size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500">
            Sync <strong>People</strong>, <strong>Locations &amp; Projects</strong> and{' '}
            <strong>Equipment</strong> from your other systems. Connect a SQL database, import a
            CSV, or link a SaaS app through Nango — then schedule it to keep records up to date.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            {connections.length === 0 ? (
              <EmptyState
                icon={<RefreshCw size={32} />}
                title="No connections yet"
                description="Add a connection on the right to start syncing people, locations and equipment from an external system."
              />
            ) : (
              <ul className="space-y-3">
                {connections.map((c) => {
                  const Icon = ICONS[c.connectorKey] ?? Database
                  return (
                    <li
                      key={c.id}
                      className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={`/admin/integrations/${c.id}`}
                          className="flex min-w-0 flex-1 gap-3"
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-100">
                            <Icon size={18} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-900">{c.name}</span>
                              <StatusPill status={c.status} />
                              {c.enabled && c.schedule ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  every {c.schedule}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                              <span>{connectorName(c.connectorKey)}</span>
                              <span>
                                {c.lastRunAt
                                  ? `last run ${new Date(c.lastRunAt).toLocaleString()} · ${c.lastStatus ?? ''}`
                                  : 'never run'}
                              </span>
                              <span className="inline-flex items-center gap-0.5 text-teal-600 opacity-0 transition group-hover:opacity-100">
                                Configure <ArrowUpRight size={12} />
                              </span>
                            </p>
                          </div>
                        </Link>
                        <form action={deleteConnection}>
                          <input type="hidden" name="id" value={c.id} />
                          <button
                            type="submit"
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            title="Delete connection"
                          >
                            <Trash2 size={15} />
                          </button>
                        </form>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>New connection</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createConnection} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="connectorKey">Source</Label>
                    <Select
                      id="connectorKey"
                      name="connectorKey"
                      defaultValue={connectors[0]?.key ?? ''}
                    >
                      {connectors.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      name="name"
                      required
                      placeholder="e.g. NetSuite — production"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <Plus size={14} /> Add connection
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Available connectors</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {connectors.map((c) => {
                  const Icon = ICONS[c.key] ?? Database
                  return (
                    <div key={c.key} className="flex gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-100">
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">{c.name}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {c.kind}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500">{c.description}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Syncs: {c.entities.map((e) => ENTITY_LABELS[e] ?? e).join(', ')}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
