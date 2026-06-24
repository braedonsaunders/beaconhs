// /admin/integrations — one hub for all integrations. Two directions share the
// same UI: sync data IN (poll an external source into People/Locations/Equipment)
// and push data OUT when an event happens (e.g. post training time to payroll).
// You add either from the same catalog; each becomes a configurable instance.
// Gated by admin.integrations.manage.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Building2,
  Database,
  FileSpreadsheet,
  Plug,
  PlugZap,
  Plus,
  Trash2,
  Upload,
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
import { syncConnections, tenantIntegrations } from '@beaconhs/db/schema'
import { listConnectors, toConnectorSummary } from '@beaconhs/sync'
import { requireRequestContext } from '@/lib/auth'
import { listOutboundIntegrations } from '@/lib/integrations'
import { PageContainer } from '@/components/page-layout'
import { AdminBackLink } from '../_back-link'
import { createConnection, deleteConnection } from './_actions'
import { deleteOutbound } from './outbound/_actions'

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

const EVENT_LABELS: Record<string, string> = {
  'training.class.completed': 'Training class completed',
}

const STATUS_PILL: Record<string, string> = {
  connected: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
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

function DirectionPill({ dir }: { dir: 'in' | 'out' }) {
  const Icon = dir === 'in' ? ArrowDownToLine : ArrowUpFromLine
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
        dir === 'in'
          ? 'bg-sky-50 text-sky-700 ring-sky-200'
          : 'bg-violet-50 text-violet-700 ring-violet-200',
      )}
    >
      <Icon size={11} />
      {dir === 'in' ? 'Sync in' : 'Push out'}
    </span>
  )
}

type ListItem = {
  id: string
  dir: 'in' | 'out'
  title: string
  subtitle: string
  status: string
  href: string
  badge?: string
  meta: string
  icon: LucideIcon
  deleteAction: (formData: FormData) => Promise<void>
  createdAt: Date
}

export default async function IntegrationsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.integrations.manage')) redirect('/admin')

  const connectors = listConnectors().map(toConnectorSummary)
  const outboundDefs = listOutboundIntegrations()
  const connectorName = (key: string) => connectors.find((c) => c.key === key)?.name ?? key

  const [connections, outbound] = await ctx.db(async (tx) => {
    const inbound = await tx
      .select({
        id: syncConnections.id,
        connectorKey: syncConnections.connectorKey,
        name: syncConnections.name,
        status: syncConnections.status,
        enabled: syncConnections.enabled,
        schedule: syncConnections.schedule,
        lastRunAt: syncConnections.lastRunAt,
        lastStatus: syncConnections.lastStatus,
        createdAt: syncConnections.createdAt,
      })
      .from(syncConnections)
      .where(isNull(syncConnections.deletedAt))
      .orderBy(desc(syncConnections.createdAt))
    const out = await tx
      .select({
        id: tenantIntegrations.id,
        integrationKey: tenantIntegrations.integrationKey,
        status: tenantIntegrations.status,
        enabled: tenantIntegrations.enabled,
        lastError: tenantIntegrations.lastError,
        lastRunAt: tenantIntegrations.lastRunAt,
        createdAt: tenantIntegrations.createdAt,
      })
      .from(tenantIntegrations)
      .where(isNull(tenantIntegrations.deletedAt))
      .orderBy(desc(tenantIntegrations.createdAt))
    return [inbound, out] as const
  })

  const addedKeys = new Set(outbound.map((o) => o.integrationKey))
  const availableOutbound = outboundDefs.filter((d) => !addedKeys.has(d.key))

  const items: ListItem[] = [
    ...connections.map(
      (c): ListItem => ({
        id: c.id,
        dir: 'in',
        title: c.name,
        subtitle: connectorName(c.connectorKey),
        status: c.status,
        href: `/admin/integrations/${c.id}`,
        badge: c.enabled && c.schedule ? `every ${c.schedule}` : undefined,
        meta: c.lastRunAt
          ? `last run ${new Date(c.lastRunAt).toLocaleString()} · ${c.lastStatus ?? ''}`
          : 'never run',
        icon: ICONS[c.connectorKey] ?? Database,
        deleteAction: deleteConnection,
        createdAt: c.createdAt,
      }),
    ),
    ...outbound.map((o): ListItem => {
      const def = outboundDefs.find((d) => d.key === o.integrationKey)
      return {
        id: o.id,
        dir: 'out',
        title: def?.name ?? o.integrationKey,
        subtitle: def
          ? def.events.map((e) => EVENT_LABELS[e] ?? e).join(', ')
          : 'Unknown integration',
        status: o.enabled ? o.status : 'disabled',
        href: `/admin/integrations/outbound/${o.id}`,
        meta: o.lastError
          ? `error: ${o.lastError}`
          : o.lastRunAt
            ? `last run ${new Date(o.lastRunAt).toLocaleString()}`
            : 'never run',
        icon: Upload,
        deleteAction: deleteOutbound,
        createdAt: o.createdAt,
      }
    }),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return (
    <PageContainer>
      <AdminBackLink />
      <div className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Plug size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500">
            Connect your other systems. <strong>Sync in</strong> to pull People, Locations &amp;
            Projects and Equipment from an external source, or <strong>push out</strong> to send
            data to another system when something happens here — like posting training time to
            payroll.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            {items.length === 0 ? (
              <EmptyState
                icon={<Plug size={32} />}
                title="No integrations yet"
                description="Add one on the right to start syncing data in or pushing data out."
              />
            ) : (
              <ul className="space-y-3">
                {items.map((c) => {
                  const Icon = c.icon
                  return (
                    <li
                      key={`${c.dir}-${c.id}`}
                      className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <Link href={c.href} className="flex min-w-0 flex-1 gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-100">
                            <Icon size={18} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-900">{c.title}</span>
                              <DirectionPill dir={c.dir} />
                              <StatusPill status={c.status} />
                              {c.badge ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  {c.badge}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                              <span>{c.subtitle}</span>
                              <span>{c.meta}</span>
                              <span className="inline-flex items-center gap-0.5 text-teal-600 opacity-0 transition group-hover:opacity-100">
                                Configure <ArrowUpRight size={12} />
                              </span>
                            </p>
                          </div>
                        </Link>
                        <form action={c.deleteAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button
                            type="submit"
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            title="Remove integration"
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
                <CardTitle>Add an integration</CardTitle>
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
                      <optgroup label="Sync data in">
                        {connectors.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                      {availableOutbound.length > 0 ? (
                        <optgroup label="Push data out">
                          {availableOutbound.map((d) => (
                            <option key={d.key} value={`outbound:${d.key}`}>
                              {d.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" placeholder="e.g. NetSuite — production" />
                    <p className="text-[11px] text-slate-400">
                      Used to label a sync source. Ignored for push-out integrations.
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <Plus size={14} /> Add
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Available integrations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                          <DirectionPill dir="in" />
                        </div>
                        <p className="text-xs text-slate-500">{c.description}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Syncs: {c.entities.map((e) => ENTITY_LABELS[e] ?? e).join(', ')}
                        </p>
                      </div>
                    </div>
                  )
                })}
                {outboundDefs.map((d) => (
                  <div key={d.key} className="flex gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-100">
                      <Upload size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{d.name}</span>
                        <DirectionPill dir="out" />
                        {addedKeys.has(d.key) ? (
                          <Badge variant="secondary" className="text-[10px]">
                            added
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-slate-500">{d.description}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Pushes on: {d.events.map((e) => EVENT_LABELS[e] ?? e).join(', ')}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
