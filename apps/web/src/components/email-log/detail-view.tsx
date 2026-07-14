// Shared email-log detail — rendered at /admin/email-log/[id] (scope 'tenant')
// and /platform/email-log/[id] (scope 'platform'). Bodies render in a sandboxed
// iframe + <pre> so we never execute third-party script tags.

import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { Badge, Card, CardContent, CardHeader, CardTitle, DetailHeader } from '@beaconhs/ui'
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
import { emailLog, tenants } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import type { EmailLogScope } from './list-view'

function statusVariant(
  status: string,
): 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' {
  switch (status) {
    case 'sent':
      return 'success'
    case 'failed':
      return 'destructive'
    case 'bounced':
      return 'destructive'
    case 'opened':
      return 'success'
    case 'queued':
      return 'outline'
    default:
      return 'secondary'
  }
}

export async function EmailLogDetailView({
  id,
  scope,
  back,
}: {
  id: string
  scope: EmailLogScope
  back: { href: string; label: string }
}) {
  const ctx = await requireRequestContext()

  const loadRow = async (tx: Database) => {
    const [r] = await tx
      .select({ log: emailLog, tenant: { id: tenants.id, name: tenants.name } })
      .from(emailLog)
      .leftJoin(tenants, eq(tenants.id, emailLog.tenantId))
      .where(
        scope === 'tenant'
          ? and(eq(emailLog.id, id), eq(emailLog.tenantId, ctx.tenantId))
          : eq(emailLog.id, id),
      )
      .limit(1)
    return r ?? null
  }
  const row = scope === 'platform' ? await withSuperAdmin(db, loadRow) : await ctx.db(loadRow)
  if (!row) notFound()

  const { log, tenant } = row
  const recipients = Array.isArray(log.recipients) ? (log.recipients as string[]) : []
  const cc = Array.isArray(log.cc) ? (log.cc as string[]) : []
  const bcc = Array.isArray(log.bcc) ? (log.bcc as string[]) : []
  const meta = (log.meta ?? {}) as Record<string, unknown>

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={back}
          title={log.subject}
          subtitle={`Queued ${formatDateTime(new Date(log.createdAt), ctx.timezone, ctx.locale)}${
            log.sentAt
              ? ` · Sent ${formatDateTime(new Date(log.sentAt), ctx.timezone, ctx.locale)}`
              : ''
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
        <Section title="Envelope" subtitle="From / To / Cc / Bcc">
          <DetailGrid
            rows={[
              { label: 'From', value: <span className="font-mono text-xs">{log.fromAddr}</span> },
              {
                label: 'Reply-to',
                value: log.replyToAddr ? (
                  <span className="font-mono text-xs">{log.replyToAddr}</span>
                ) : (
                  '—'
                ),
              },
              {
                label: `To (${recipients.length})`,
                value:
                  recipients.length === 0 ? (
                    '—'
                  ) : (
                    <ul className="space-y-0.5 font-mono text-xs">
                      {recipients.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ),
              },
              {
                label: `Cc (${cc.length})`,
                value:
                  cc.length === 0 ? (
                    '—'
                  ) : (
                    <ul className="space-y-0.5 font-mono text-xs">
                      {cc.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ),
              },
              {
                label: `Bcc (${bcc.length})`,
                value:
                  bcc.length === 0 ? (
                    '—'
                  ) : (
                    <ul className="space-y-0.5 font-mono text-xs">
                      {bcc.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ),
              },
              { label: 'Subject', value: log.subject },
              {
                label: 'Category',
                value: log.categoryKey ?? <span className="text-slate-400">—</span>,
              },
              {
                label: 'Tenant',
                value: tenant?.name ?? <span className="text-slate-400">platform</span>,
              },
            ]}
          />
        </Section>

        <Section title="Delivery timeline" subtitle="Lifecycle from queued to terminal status">
          <DetailGrid
            rows={[
              {
                label: 'Created (queued)',
                value: formatDateTime(new Date(log.createdAt), ctx.timezone, ctx.locale),
              },
              {
                label: 'Sent',
                value: log.sentAt
                  ? formatDateTime(new Date(log.sentAt), ctx.timezone, ctx.locale)
                  : '—',
              },
              {
                label: 'Opened',
                value: log.openedAt
                  ? formatDateTime(new Date(log.openedAt), ctx.timezone, ctx.locale)
                  : '—',
              },
              {
                label: 'Bounced',
                value: log.bouncedAt
                  ? formatDateTime(new Date(log.bouncedAt), ctx.timezone, ctx.locale)
                  : '—',
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
                label: 'HTML size',
                value: `${log.htmlSize.toLocaleString()} bytes`,
              },
              {
                label: 'Text size',
                value: `${log.textSize.toLocaleString()} bytes`,
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
            <CardTitle className="text-base">HTML body</CardTitle>
          </CardHeader>
          <CardContent>
            {log.htmlBody ? (
              <iframe
                title="email-html"
                sandbox=""
                srcDoc={log.htmlBody}
                className="h-[640px] w-full rounded-md border border-slate-200 bg-white"
              />
            ) : (
              <p className="text-sm text-slate-500">No HTML body recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Text body</CardTitle>
          </CardHeader>
          <CardContent>
            {log.textBody ? (
              <pre className="max-h-[640px] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] whitespace-pre-wrap text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                {log.textBody}
              </pre>
            ) : (
              <p className="text-sm text-slate-500">No text body recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DetailPageLayout>
  )
}
