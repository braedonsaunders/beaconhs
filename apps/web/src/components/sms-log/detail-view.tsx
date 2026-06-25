// Shared SMS-log detail — rendered at /admin/sms-log/[id] (scope 'tenant') and
// /platform/sms-log/[id] (scope 'platform'). Mirrors the email-log detail.

import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { Badge, Card, CardContent, CardHeader, CardTitle, DetailHeader } from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import { smsLog, tenants } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
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
  const ctx = await requireRequestContext()

  const row = await withSuperAdmin(db, async (tx) => {
    const [r] = await tx
      .select({ log: smsLog, tenant: { id: tenants.id, name: tenants.name } })
      .from(smsLog)
      .leftJoin(tenants, eq(tenants.id, smsLog.tenantId))
      .where(eq(smsLog.id, id))
      .limit(1)
    return r ?? null
  })
  if (!row) notFound()

  // The tenant view only exposes the active tenant's rows (and platform-level
  // rows). The platform route is super-admin-gated by its layout.
  if (scope === 'tenant' && row.log.tenantId && row.log.tenantId !== ctx.tenantId) {
    notFound()
  }

  const { log, tenant } = row
  const meta = (log.meta ?? {}) as Record<string, unknown>

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={back}
          title={log.recipient ?? 'SMS'}
          subtitle={`Sent ${new Date(log.createdAt).toLocaleString()}${
            log.provider ? ` · via ${log.provider}` : ''
          }`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant(log.status)}>{log.status}</Badge>
              {log.categoryKey ? (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {log.categoryKey}
                </Badge>
              ) : null}
            </div>
          }
        />
      }
    >
      <div className="space-y-5">
        <Section title="Delivery" subtitle="Recipient, provider and outcome">
          <DetailGrid
            rows={[
              {
                label: 'To',
                value: log.recipient ? (
                  <span className="font-mono text-xs">{log.recipient}</span>
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
                value: <Badge variant={statusVariant(log.status)}>{log.status}</Badge>,
              },
              {
                label: 'Category',
                value: log.categoryKey ?? <span className="text-slate-400">—</span>,
              },
              {
                label: 'Tenant',
                value: tenant?.name ?? <span className="text-slate-400">platform</span>,
              },
              {
                label: 'Created',
                value: new Date(log.createdAt).toLocaleString(),
              },
              {
                label: 'Sent',
                value: log.sentAt ? new Date(log.sentAt).toLocaleString() : '—',
              },
              {
                label: 'Provider message id',
                value: log.providerMessageId ? (
                  <span className="font-mono text-xs">{log.providerMessageId}</span>
                ) : (
                  '—'
                ),
              },
              {
                label: 'BullMQ job id',
                value: log.jobId ? <span className="font-mono text-xs">{log.jobId}</span> : '—',
              },
              {
                label: 'Length',
                value: `${log.bodyLength.toLocaleString()} chars`,
              },
            ]}
          />
          {log.errorMessage ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <div className="mb-1 text-xs font-semibold tracking-wide uppercase">Error</div>
              <pre className="font-mono text-[12px] whitespace-pre-wrap">{log.errorMessage}</pre>
            </div>
          ) : null}
        </Section>

        {Object.keys(meta).length > 0 ? (
          <Section title="Meta">
            <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
              {JSON.stringify(meta, null, 2)}
            </pre>
          </Section>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message</CardTitle>
          </CardHeader>
          <CardContent>
            {log.body ? (
              <pre className="max-h-[480px] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[13px] whitespace-pre-wrap text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                {log.body}
              </pre>
            ) : (
              <p className="text-sm text-slate-500">No message body recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DetailPageLayout>
  )
}
