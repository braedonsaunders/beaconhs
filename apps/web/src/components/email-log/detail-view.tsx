import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
          title={tGeneratedValue(log.subject)}
          subtitle={tGenerated('m_1ba2554badfb59', {
            value0: formatDateTime(new Date(log.createdAt), ctx.timezone, ctx.locale),
            value1: log.sentAt
              ? ` · Sent ${formatDateTime(new Date(log.sentAt), ctx.timezone, ctx.locale)}`
              : '',
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
        <Section title={tGenerated('m_15e4adc882b93b')} subtitle={tGenerated('m_1ba9ebf4497bf3')}>
          <DetailGrid
            rows={[
              {
                label: 'From',
                value: (
                  <span className="font-mono text-xs">
                    <GeneratedValue value={log.fromAddr} />
                  </span>
                ),
              },
              {
                label: 'Reply-to',
                value: log.replyToAddr ? (
                  <span className="font-mono text-xs">
                    <GeneratedValue value={log.replyToAddr} />
                  </span>
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
                      <GeneratedValue
                        value={recipients.map((r) => (
                          <li key={r}>
                            <GeneratedValue value={r} />
                          </li>
                        ))}
                      />
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
                      <GeneratedValue
                        value={cc.map((r) => (
                          <li key={r}>
                            <GeneratedValue value={r} />
                          </li>
                        ))}
                      />
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
                      <GeneratedValue
                        value={bcc.map((r) => (
                          <li key={r}>
                            <GeneratedValue value={r} />
                          </li>
                        ))}
                      />
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
                value: tenant?.name ?? (
                  <span className="text-slate-400">
                    <GeneratedText id="m_123000091889d1" />
                  </span>
                ),
              },
            ]}
          />
        </Section>

        <Section title={tGenerated('m_02dd8cec1837ae')} subtitle={tGenerated('m_1a329cd239abb4')}>
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
                label: 'HTML size',
                value: `${log.htmlSize.toLocaleString()} bytes`,
              },
              {
                label: 'Text size',
                value: `${log.textSize.toLocaleString()} bytes`,
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
              <GeneratedText id="m_1c02f6ac2cf2ed" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GeneratedValue
              value={
                log.htmlBody ? (
                  <iframe
                    title={tGenerated('m_03ea41a36057c1')}
                    sandbox=""
                    srcDoc={log.htmlBody}
                    className="h-[640px] w-full rounded-md border border-slate-200 bg-white"
                  />
                ) : (
                  <p className="text-sm text-slate-500">
                    <GeneratedText id="m_0ff4b3247765b0" />
                  </p>
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <GeneratedText id="m_1f55a9248ef92d" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GeneratedValue
              value={
                log.textBody ? (
                  <pre className="max-h-[640px] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] whitespace-pre-wrap text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                    {log.textBody}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-500">
                    <GeneratedText id="m_185b18160a6017" />
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
