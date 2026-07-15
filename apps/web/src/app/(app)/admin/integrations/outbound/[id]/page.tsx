import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// /admin/integrations/outbound/[id] — build one outbound automation: pick a
// trigger + destination, configure + map, test, enable. Gated by
// admin.integrations.manage.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent, cn } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { tenantIntegrations } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { getTrigger, listDestinations, listTriggers } from '@beaconhs/integrations'
import { formatDateTime } from '@/lib/datetime'
import { isUuid } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { deleteOutbound } from '../_actions'
import { DeleteIntegrationButton } from '../../_delete-integration-button'
import { IntegrationBuilder, type DestLite } from './_builder.client'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0e2cf7bcf1a80f') }
}
export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  ready:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  draft:
    'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  disabled:
    'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
  error:
    'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900',
}

export default async function OutboundIntegrationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.integrations.manage')) redirect('/admin')

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.id, id), isNull(tenantIntegrations.deletedAt)))
      .limit(1)
    return r ?? null
  })
  if (!row) notFound()

  const config = (row.config as Record<string, unknown>) ?? {}
  const secrets = (row.secrets as Record<string, unknown>) ?? {}
  const status = row.enabled ? row.status : 'disabled'
  const trigger = getTrigger(row.triggerKey)

  // Strip the (non-serialisable) deliver/test fns for the client.
  const destinations: DestLite[] = listDestinations().map((d) => ({
    key: d.key,
    name: d.name,
    description: d.description,
    mappingKind: d.mappingKind,
    reversible: d.reversible,
    configFields: d.configFields,
    secretFields: d.secretFields,
  }))

  return (
    <PageContainer>
      <div className="space-y-6">
        <Link
          href="/admin/integrations"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft size={14} /> <GeneratedText id="m_1c8ed3217c8450" />
        </Link>

        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedValue
                value={row.name || trigger?.label || <GeneratedText id="m_0fbcdc0def03aa" />}
              />
            </h1>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
                STATUS_PILL[status] ?? STATUS_PILL.draft,
              )}
            >
              <GeneratedValue value={status} />
            </span>
          </div>
          <GeneratedValue
            value={
              row.lastError ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  <GeneratedText id="m_0e157303f3a90f" /> <GeneratedValue value={row.lastError} />
                </p>
              ) : row.lastRunAt ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  <GeneratedText id="m_1236782a321d73" />{' '}
                  <GeneratedValue
                    value={formatDateTime(new Date(row.lastRunAt), ctx.timezone, ctx.locale)}
                  />
                </p>
              ) : null
            }
          />
        </header>

        <Card>
          <CardContent className="pt-6">
            <IntegrationBuilder
              id={row.id}
              initial={{
                name: row.name ?? '',
                enabled: row.enabled,
                oncePerRecord: config.oncePerRecord === true,
                triggerKey: row.triggerKey ?? '',
                destinationKey: row.destinationKey ?? '',
                config,
                secretsPresent: Object.fromEntries(Object.keys(secrets).map((k) => [k, true])),
                mapping: (config.mapping as Record<string, unknown>) ?? {},
              }}
              triggers={listTriggers()}
              destinations={destinations}
            />
          </CardContent>
        </Card>

        <DeleteIntegrationButton
          id={row.id}
          name={row.name || trigger?.label || 'this automation'}
          kind="automation"
          iconOnly={false}
          label={tGenerated('m_1a68ace74e02ea')}
          deleteAction={deleteOutbound}
        />
      </div>
    </PageContainer>
  )
}
