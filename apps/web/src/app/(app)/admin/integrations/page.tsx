import { getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// /admin/integrations — one hub for all integrations. Sync data IN (poll an
// external source into People/Locations/Equipment) and push data OUT when an
// event happens (e.g. post training time to payroll) live together: a
// "Connected" grid of active instances on top, and a searchable "Browse"
// catalog below. Gated by admin.integrations.manage.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowUpRight,
  Building2,
  Database,
  FileSpreadsheet,
  Plug,
  PlugZap,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { desc, isNull } from 'drizzle-orm'
import { Badge } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { syncConnections, tenantIntegrations } from '@beaconhs/db/schema'
import { listConnectors, toConnectorSummary } from '@beaconhs/sync'
import { requireRequestContext } from '@/lib/auth'
import { getDestination, getTrigger, listDestinations } from '@beaconhs/integrations'
import { formatDateTime } from '@/lib/datetime'
import { PageContainer } from '@/components/page-layout'
import { AdminBackLink } from '../_back-link'
import { deleteConnection } from './_actions'
import { deleteOutbound } from './outbound/_actions'
import { DirectionPill, StatusPill } from './_pills'
import { IntegrationCatalog, type CatalogItem } from './_catalog.client'
import { DeleteIntegrationButton } from './_delete-integration-button'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1cff4ed9a7e699') }
}
export const dynamic = 'force-dynamic'

const ICONS: Record<string, LucideIcon> = {
  database: Database,
  'building-2': Building2,
  'file-spreadsheet': FileSpreadsheet,
  'plug-zap': PlugZap,
  upload: Upload,
}

const ENTITY_LABELS: Record<string, string> = {
  people: 'People',
  org_unit: 'Locations & Projects',
  equipment: 'Equipment',
  contact: 'Contacts',
}

type Connected = {
  id: string
  dir: 'in' | 'out'
  title: string
  subtitle: string
  status: string
  href: string
  badge?: string
  meta: string
  iconKey: string
  deleteAction: (formData: FormData) => Promise<void>
  createdAt: Date
}

export default async function IntegrationsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.integrations.manage')) redirect('/admin')

  const connectors = listConnectors().map(toConnectorSummary)
  const iconFor = (key: string) => connectors.find((c) => c.key === key)?.iconKey ?? 'database'
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
        name: tenantIntegrations.name,
        triggerKey: tenantIntegrations.triggerKey,
        destinationKey: tenantIntegrations.destinationKey,
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

  const connected: Connected[] = [
    ...connections.map((c): Connected => ({
      id: c.id,
      dir: 'in',
      title: c.name,
      subtitle: connectorName(c.connectorKey),
      status: c.status,
      href: `/admin/integrations/${c.id}`,
      badge: c.enabled && c.schedule ? `every ${c.schedule}` : undefined,
      meta: c.lastRunAt
        ? `last run ${formatDateTime(new Date(c.lastRunAt), ctx.timezone, ctx.locale)} · ${c.lastStatus ?? ''}`
        : 'never run',
      iconKey: iconFor(c.connectorKey),
      deleteAction: deleteConnection,
      createdAt: c.createdAt,
    })),
    ...outbound.map((o): Connected => {
      const dest = getDestination(o.destinationKey)
      const trig = getTrigger(o.triggerKey)
      const subtitle =
        trig && dest ? `${trig.label} → ${dest.name}` : (dest?.name ?? 'Not configured')
      return {
        id: o.id,
        dir: 'out',
        title: o.name || dest?.name || 'Untitled automation',
        subtitle,
        status: o.enabled ? o.status : 'disabled',
        href: `/admin/integrations/outbound/${o.id}`,
        meta: o.lastError
          ? `error: ${o.lastError}`
          : o.lastRunAt
            ? `last run ${formatDateTime(new Date(o.lastRunAt), ctx.timezone, ctx.locale)}`
            : 'never run',
        iconKey: 'upload',
        deleteAction: deleteOutbound,
        createdAt: o.createdAt,
      }
    }),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  const catalog: CatalogItem[] = [
    ...connectors.map((c): CatalogItem => ({
      key: `in:${c.key}`,
      addValue: c.key,
      name: c.name,
      description: c.description,
      dir: 'in',
      iconKey: c.iconKey ?? 'database',
      detail: `Syncs ${c.entities.map((e) => ENTITY_LABELS[e] ?? e).join(', ')}`,
      added: false,
    })),
    ...listDestinations().map((d): CatalogItem => ({
      key: `out:${d.key}`,
      addValue: `outbound:${d.key}`,
      name: `Send to ${d.name}`,
      description: d.description,
      dir: 'out',
      iconKey: 'upload',
      detail: 'Any trigger → this service',
      added: false,
    })),
  ]

  return (
    <PageContainer>
      <AdminBackLink />
      <div className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Plug size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_1cff4ed9a7e699" />
            </h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_1b9edee39425a9" />{' '}
            <strong>
              <GeneratedText id="m_1cdce60ecabce0" />
            </strong>{' '}
            <GeneratedText id="m_1ba396958daf36" />{' '}
            <strong>
              <GeneratedText id="m_0912221f179725" />
            </strong>{' '}
            <GeneratedText id="m_030d0e813977cf" />
          </p>
        </header>

        <section className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase dark:text-slate-300">
              <GeneratedText id="m_061faebf66749d" />
            </h2>
            <span className="text-xs text-slate-400">
              <GeneratedValue value={connected.length} />
            </span>
          </div>
          <GeneratedValue
            value={
              connected.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-5 py-8 text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <GeneratedText id="m_0ae576e58173ac" />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <GeneratedValue
                    value={connected.map((c) => {
                      const Icon = ICONS[c.iconKey] ?? Database
                      return (
                        <div
                          key={`${c.dir}-${c.id}`}
                          className="group relative flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700"
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                            <Icon size={18} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={c.href}
                                className="font-semibold text-slate-900 after:absolute after:inset-0 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-400"
                              >
                                <GeneratedValue value={c.title} />
                              </Link>
                              <DirectionPill dir={c.dir} />
                              <StatusPill status={c.status} />
                              <GeneratedValue
                                value={
                                  c.badge ? (
                                    <Badge variant="secondary" className="text-[10px]">
                                      <GeneratedValue value={c.badge} />
                                    </Badge>
                                  ) : null
                                }
                              />
                            </div>
                            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                              <GeneratedValue value={c.subtitle} />
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
                              <GeneratedValue value={c.meta} />
                            </p>
                          </div>
                          <div className="relative z-10 flex items-center gap-1 self-center text-slate-300 transition group-hover:text-slate-400">
                            <ArrowUpRight size={15} className="hidden sm:block" />
                            <DeleteIntegrationButton
                              id={c.id}
                              name={c.title}
                              kind={c.dir === 'out' ? 'automation' : 'connection'}
                              deleteAction={c.deleteAction}
                            />
                          </div>
                        </div>
                      )
                    })}
                  />
                </div>
              )
            }
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase dark:text-slate-300">
            <GeneratedText id="m_1d163d33f3ba04" />
          </h2>
          <IntegrationCatalog items={catalog} />
        </section>
      </div>
    </PageContainer>
  )
}
