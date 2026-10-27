import Link from 'next/link'
import { and, count, desc, eq, ilike, inArray, or } from 'drizzle-orm'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@beaconhs/ui'
import { emailLog, people, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import { formatDateTime } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { FilterChips } from './filter-bar'
import { Pagination } from './pagination'
import { SearchInput } from './search-input'

const PER_PAGE = 25
const STATUSES = ['queued', 'sent', 'failed', 'bounced', 'opened'] as const

function statusVariant(
  status: string,
): 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' {
  switch (status) {
    case 'sent':
    case 'opened':
      return 'success'
    case 'failed':
    case 'bounced':
      return 'destructive'
    case 'queued':
      return 'outline'
    default:
      return 'secondary'
  }
}

/**
 * Emails sent about one record (email_log rows carrying its subject link).
 * Recipient names show for anyone who can open the record; raw addresses
 * only when `canSeeAddresses` (the record's managers or email-log viewers).
 */
export async function RecordEmails({
  ctx,
  subjectType,
  subjectId,
  basePath,
  searchParams,
  canSeeAddresses,
}: {
  ctx: RequestContext
  subjectType: string
  subjectId: string
  basePath: string
  searchParams: Record<string, string | string[] | undefined>
  canSeeAddresses: boolean
}) {
  const t = await getGeneratedValueTranslations()
  const params = parseListParams(
    { page: searchParams.emailPage, q: searchParams.emailQ },
    { perPage: PER_PAGE, sort: 'date', allowedSorts: ['date'] },
  )
  const statusFilter = pickString(searchParams.emailStatus)
  const q = params.q?.trim()

  const data = await ctx.db(async (tx) => {
    const base = and(
      eq(emailLog.tenantId, ctx.tenantId),
      eq(emailLog.subjectType, subjectType),
      eq(emailLog.subjectId, subjectId),
    )
    const search = q
      ? canSeeAddresses
        ? or(ilike(emailLog.subject, `%${q}%`), ilike(emailLog.recipientPrimary, `%${q}%`))
        : ilike(emailLog.subject, `%${q}%`)
      : undefined
    const statusCond =
      statusFilter && (STATUSES as readonly string[]).includes(statusFilter)
        ? eq(emailLog.status, statusFilter as (typeof STATUSES)[number])
        : undefined
    const where = and(base, search, statusCond)
    const [[totalRow], [filteredRow], statusRows, rows] = await Promise.all([
      tx.select({ c: count() }).from(emailLog).where(base),
      tx.select({ c: count() }).from(emailLog).where(where),
      tx
        .select({ status: emailLog.status, c: count() })
        .from(emailLog)
        .where(base)
        .groupBy(emailLog.status),
      tx
        .select({
          id: emailLog.id,
          subject: emailLog.subject,
          recipients: emailLog.recipients,
          status: emailLog.status,
          sentAt: emailLog.sentAt,
          createdAt: emailLog.createdAt,
          errorMessage: emailLog.errorMessage,
        })
        .from(emailLog)
        .where(where)
        .orderBy(desc(emailLog.createdAt), desc(emailLog.id))
        .limit(PER_PAGE)
        .offset((params.page - 1) * PER_PAGE),
    ])

    const addresses = [...new Set(rows.flatMap((r) => r.recipients.map((a) => a.toLowerCase())))]
    const names = new Map<string, string>()
    if (addresses.length > 0) {
      const [personRows, userRows] = await Promise.all([
        tx
          .select({
            email: people.email,
            first: people.firstName,
            last: people.lastName,
          })
          .from(people)
          .where(inArray(people.email, addresses)),
        tx
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(inArray(users.email, addresses)),
      ])
      for (const u of userRows) if (u.email && u.name) names.set(u.email.toLowerCase(), u.name)
      for (const p of personRows) {
        const name = `${p.first} ${p.last}`.trim()
        if (p.email && name) names.set(p.email.toLowerCase(), name)
      }
    }
    return {
      total: Number(totalRow?.c ?? 0),
      filtered: Number(filteredRow?.c ?? 0),
      statusCounts: new Map(statusRows.map((r) => [r.status, Number(r.c)])),
      rows,
      names,
    }
  })

  function recipientLabel(address: string): string {
    const name = data.names.get(address.toLowerCase())
    if (canSeeAddresses) return name ? `${name} <${address}>` : address
    return name ?? t('External recipient')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedValue value={t('Emails')} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <SearchInput
            placeholder={t(canSeeAddresses ? 'Search subject or recipient…' : 'Search subject…')}
            paramKey="emailQ"
            pageParamKey="emailPage"
          />
          <FilterChips
            basePath={basePath}
            currentParams={searchParams}
            paramKey="emailStatus"
            pageParamKey="emailPage"
            label={t('Status')}
            options={STATUSES.filter((s) => data.statusCounts.has(s)).map((s) => ({
              value: s,
              label: t(s),
              count: data.statusCounts.get(s) ?? 0,
            }))}
          />
        </div>
        {data.rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <GeneratedValue
              value={t(
                data.total === 0
                  ? 'No emails have been sent for this record yet.'
                  : 'No emails match this search.',
              )}
            />
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-3 font-medium">
                    <GeneratedValue value={t('Subject')} />
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <GeneratedValue value={t('Recipients')} />
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <GeneratedValue value={t('Status')} />
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <GeneratedValue value={t('Sent')} />
                  </th>
                  <th className="py-2 font-medium">
                    <GeneratedValue value={t('Error')} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 align-top dark:border-slate-800"
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/admin/email-log/${row.id}`}
                        className="text-teal-700 hover:underline dark:text-teal-300"
                      >
                        <GeneratedValue value={row.subject} />
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">
                      <GeneratedValue
                        value={row.recipients.map(recipientLabel).join(', ') || '—'}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={statusVariant(row.status)}>
                        <GeneratedValue value={t(row.status)} />
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      <GeneratedValue
                        value={
                          row.sentAt
                            ? formatDateTime(row.sentAt, ctx.timezone, ctx.locale)
                            : formatDateTime(row.createdAt, ctx.timezone, ctx.locale)
                        }
                      />
                    </td>
                    <td className="py-2">
                      <span
                        className="block max-w-md truncate text-xs text-red-600 dark:text-red-400"
                        title={row.errorMessage ?? undefined}
                      >
                        <GeneratedValue value={row.errorMessage ?? ''} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          basePath={basePath}
          currentParams={searchParams}
          pageParamKey="emailPage"
          page={params.page}
          perPage={PER_PAGE}
          total={data.filtered}
        />
      </CardContent>
    </Card>
  )
}
