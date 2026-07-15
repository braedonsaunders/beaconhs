import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// Shared SMS-log detail — rendered at /admin/sms-log/[id] (scope 'tenant') and
// /platform/sms-log/[id] (scope 'platform'). Mirrors the email-log detail.

import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { Badge, Card, CardContent, CardHeader, CardTitle, DetailHeader } from '@beaconhs/ui'
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
import { smsLog, tenants } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import type { SmsLogScope } from './list-view'

function statusVariant(
  status: string,
): 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' {
  switch (status) {
    case 'sent':
      return 'success'
    case 'failed':
      return 'destructive'
    case 'suppressed':
      return 'warning'
    case 'skipped':
      return 'outline'
    default:
      return 'secondary'
  }
}

export async function SmsLogDetailView({
  id,
  scope,
  back,
}: {
  id: string
  scope: SmsLogScope
  back: { href: string; label: string }
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()

  const loadRow = async (tx: Database) => {
    const [r] = await tx
      .select({ log: smsLog, tenant: { id: tenants.id, name: tenants.name } })
      .from(smsLog)
      .leftJoin(tenants, eq(tenants.id, smsLog.tenantId))
      .where(
        scope === 'tenant'
          ? and(eq(smsLog.id, id), eq(smsLog.tenantId, ctx.tenantId))
          : eq(smsLog.id, id),
      )
      .limit(1)
    return r ?? null
  }
  const row = scope === 'platform' ? await withSuperAdmin(db, loadRow) : await ctx.db(loadRow)
  if (!row) notFound()

  const { log, tenant } = row
  const meta = (log.meta ?? {}) as Record<string, unknown>

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={back}
          title={tGeneratedValue(log.recipient ?? tGenerated('m_090cf61ef27662'))}
          subtitle={tGenerated('m_0affd4b7cf5554', {
            value0: formatDateTime(new Date(log.createdAt), ctx.timezone, ctx.locale),
            value1: log.provider ? ` · via ${log.provider}` : '',
          })}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant(log.status)}>
                <GeneratedValue value={log.status} />
              </Badge>
              <GeneratedValue
                value={
                  log.categoryKey ? (
                    <Badge variant="outline" className="font-mono text-[11px]">
                      <GeneratedValue value={log.categoryKey} />
                    </Badge>
                  ) : null
                }
              />
            </div>
          }
        />
      }
    >
      <div className="space-y-5">
        <Section title={tGenerated('m_03db87cb2e7846')} subtitle={tGenerated('m_1b29db08c7188e')}>
          <DetailGrid
            rows={[
              {
                label: 'To',
                value: log.recipient ? (
                  <span className="font-mono text-xs">
                    <GeneratedValue value={log.recipient} />
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                ),
              },
              {
                label: 'Provider',
                value: log.provider ?? <span className="text-slate-400">—</span>,
              },
              {
                label: 'Status',
                value: (
                  <Badge variant={statusVariant(log.status)}>
                    <GeneratedValue value={log.status} />
                  </Badge>
                ),
              },
              {
                label: 'Category',
                value: log.categoryKey ?? <span className="text-slate-400">—</span>,
              },
              {
                label: 'Tenant',
                value: tenant?.name ?? (
                  <span className="text-slate-400">
                    <GeneratedText id="m_123000091889d1" />
                  </span>
                ),
              },
              {
                label: 'Created',
                value: formatDateTime(new Date(log.createdAt), ctx.timezone, ctx.locale),
              },
              {
                label: 'Sent',
                value: log.sentAt
                  ? formatDateTime(new Date(log.sentAt), ctx.timezone, ctx.locale)
                  : '—',
              },
              {
                label: 'Provider message id',
                value: log.providerMessageId ? (
                  <span className="font-mono text-xs">
                    <GeneratedValue value={log.providerMessageId} />
                  </span>
                ) : (
                  '—'
                ),
              },
              {
                label: 'BullMQ job id',
                value: log.jobId ? (
                  <span className="font-mono text-xs">
                    <GeneratedValue value={log.jobId} />
                  </span>
                ) : (
                  '—'
                ),
              },
              {
                label: 'Length',
                value: `${log.bodyLength.toLocaleString()} chars`,
              },
            ]}
          />
          <GeneratedValue
            value={
              log.errorMessage ? (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  <div className="mb-1 text-xs font-semibold tracking-wide uppercase">
                    <GeneratedText id="m_1cb826f5006e77" />
                  </div>
                  <pre className="font-mono text-[12px] whitespace-pre-wrap">
                    {log.errorMessage}
                  </pre>
                </div>
              ) : null
            }
          />
        </Section>

        <GeneratedValue
          value={
            Object.keys(meta).length > 0 ? (
              <Section title={tGenerated('m_11206adc9956a4')}>
                <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {JSON.stringify(meta, null, 2)}
                </pre>
              </Section>
            ) : null
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <GeneratedText id="m_0e4ff640f8e7d6" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GeneratedValue
              value={
                log.body ? (
                  <pre className="max-h-[480px] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[13px] whitespace-pre-wrap text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                    {log.body}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-500">
                    <GeneratedText id="m_1d743375ec7e06" />
                  </p>
                )
              }
            />
          </CardContent>
        </Card>
      </div>
    </DetailPageLayout>
  )
}
