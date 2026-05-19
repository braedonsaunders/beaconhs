// Admin email-log detail.
//
// Shows the full saved record: recipients, subject, html + text body, the
// delivery timeline (queued → sent → opened / bounced / failed) and any
// error message. Bodies are rendered in <pre> + an iframe sandbox so we
// avoid executing whatever script tags a third party may have included.

import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
} from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import { emailLog, tenants } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Email · ${id.slice(0, 8)}` }
}

function statusVariant(status: string): 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' {
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

export default async function EmailLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const row = await withSuperAdmin(db, async (tx) => {
    const [r] = await tx
      .select({ log: emailLog, tenant: { id: tenants.id, name: tenants.name } })
      .from(emailLog)
      .leftJoin(tenants, eq(tenants.id, emailLog.tenantId))
      .where(eq(emailLog.id, id))
      .limit(1)
    return r ?? null
  })
  if (!row) notFound()

  // Tenant scope check: regular users can only see their own tenant or
  // platform-level rows.
  if (!ctx.isSuperAdmin && row.log.tenantId && row.log.tenantId !== ctx.tenantId) {
    notFound()
  }

  const { log, tenant } = row
  const recipients = Array.isArray(log.recipients) ? (log.recipients as string[]) : []
  const cc = Array.isArray(log.cc) ? (log.cc as string[]) : []
  const bcc = Array.isArray(log.bcc) ? (log.bcc as string[]) : []
  const meta = (log.meta ?? {}) as Record<string, unknown>

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/admin/email-log', label: 'Back to email log' }}
          title={log.subject}
          subtitle={`Queued ${new Date(log.createdAt).toLocaleString()}${
            log.sentAt ? ` · Sent ${new Date(log.sentAt).toLocaleString()}` : ''
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
                value: new Date(log.createdAt).toLocaleString(),
              },
              {
                label: 'Sent',
                value: log.sentAt ? new Date(log.sentAt).toLocaleString() : '—',
              },
              {
                label: 'Opened',
                value: log.openedAt ? new Date(log.openedAt).toLocaleString() : '—',
              },
              {
                label: 'Bounced',
                value: log.bouncedAt ? new Date(log.bouncedAt).toLocaleString() : '—',
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
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide">
                Error
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[12px]">{log.errorMessage}</pre>
            </div>
          ) : null}
        </Section>

        {Object.keys(meta).length > 0 ? (
          <Section title="Meta">
            <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-800">
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
              <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] text-slate-800">
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
