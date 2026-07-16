import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { BookText, Download, Key } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { apiKeys, formTemplates } from '@beaconhs/db/schema'
import { PageContainer } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { permissionGroupLabel } from '@/lib/permissions-meta'
import { PermissionMatrix } from '../roles/_components/permission-matrix'
import { createApiKey, dismissReveal, revokeApiKey } from './_actions'
import { requireApiKeyAdmin } from './_guard'
import { apiKeyIdFromRevealCookie } from './_reveal-cookie'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_100ad61f23e3c3') }
}
export const dynamic = 'force-dynamic'

const BASE = '/admin/api-keys'
const SORTS = ['name', 'created', 'expires', 'lastUsed', 'status'] as const

// Outline-button styling for anchor links (the Button component doesn't render
// as an anchor, so links are styled <a> elements — matching the app's pattern).
const DOC_LINK_CLASS =
  'inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800/60'

function permissionSummary(permissions: string[]) {
  if (permissions.length === 0)
    return (
      <span className="text-xs text-slate-400">
        <GeneratedText id="m_1fddcd7c1dea78" />
      </span>
    )
  const byGroup = new Map<string, number>()
  for (const permission of permissions) {
    const group = permissionGroupLabel(permission)
    byGroup.set(group, (byGroup.get(group) ?? 0) + 1)
  }
  const entries = [...byGroup.entries()].slice(0, 3)
  return (
    <span className="flex flex-wrap gap-1" title={permissions.join(', ')}>
      <GeneratedValue
        value={entries.map(([group, count]) => (
          <span
            key={group}
            className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <GeneratedValue value={group} /> <GeneratedValue value={count} />
          </span>
        ))}
      />
      <GeneratedValue
        value={
          byGroup.size > entries.length ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              +<GeneratedValue value={byGroup.size - entries.length} />
            </span>
          ) : null
        }
      />
    </span>
  )
}

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireApiKeyAdmin()
  const sp = await searchParams
  const statusParam = pickString(sp.status)
  const statusFilter =
    statusParam === 'active' || statusParam === 'expired' || statusParam === 'revoked'
      ? statusParam
      : undefined
  const params = parseListParams(sp, {
    sort: 'created',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const nowDate = new Date()
  const [list, builderApps] = await Promise.all([
    ctx.db(async (tx) => {
      const search: SQL<unknown> | undefined = params.q
        ? or(ilike(apiKeys.name, `%${params.q}%`), ilike(apiKeys.prefix, `%${params.q}%`))
        : undefined
      const active = and(
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, nowDate)),
      )
      const expired = and(isNull(apiKeys.revokedAt), lte(apiKeys.expiresAt, nowDate))
      const revoked = isNotNull(apiKeys.revokedAt)
      const status =
        statusFilter === 'active'
          ? active
          : statusFilter === 'expired'
            ? expired
            : statusFilter === 'revoked'
              ? revoked
              : undefined
      const where = and(search, status)
      const statusRank = sql<number>`case when ${apiKeys.revokedAt} is not null then 3 when ${apiKeys.expiresAt} is not null and ${apiKeys.expiresAt} <= ${nowDate.toISOString()}::timestamptz then 2 else 1 end`
      const dirFn = params.dir === 'asc' ? asc : desc
      const orderBy =
        params.sort === 'name'
          ? [dirFn(apiKeys.name)]
          : params.sort === 'expires'
            ? [dirFn(apiKeys.expiresAt), asc(apiKeys.name)]
            : params.sort === 'lastUsed'
              ? [dirFn(apiKeys.lastUsedAt), asc(apiKeys.name)]
              : params.sort === 'status'
                ? [dirFn(statusRank), asc(apiKeys.name)]
                : [dirFn(apiKeys.createdAt)]
      const baseCount = () => tx.select({ c: count() }).from(apiKeys)
      const [totalRow, activeRow, expiredRow, revokedRow, rows] = await Promise.all([
        baseCount().where(where),
        baseCount().where(and(search, active)),
        baseCount().where(and(search, expired)),
        baseCount().where(and(search, revoked)),
        tx
          .select()
          .from(apiKeys)
          .where(where)
          .orderBy(...orderBy)
          .limit(params.perPage)
          .offset((params.page - 1) * params.perPage),
      ])
      return {
        rows,
        total: Number(totalRow[0]?.c ?? 0),
        statusCounts: {
          active: Number(activeRow[0]?.c ?? 0),
          expired: Number(expiredRow[0]?.c ?? 0),
          revoked: Number(revokedRow[0]?.c ?? 0),
        },
      }
    }),
    ctx.db((tx) =>
      tx
        .select({ id: formTemplates.id, name: formTemplates.name })
        .from(formTemplates)
        .where(and(eq(formTemplates.status, 'published'), isNull(formTemplates.deletedAt)))
        .orderBy(asc(formTemplates.name)),
    ),
  ])
  const cookieStore = await cookies()
  const reveals = cookieStore.getAll().flatMap((cookie) => {
    const apiKeyId = apiKeyIdFromRevealCookie(cookie.name)
    if (!apiKeyId) return []
    const row = list.rows.find((candidate) => candidate.id === apiKeyId)
    return [
      {
        cookieName: cookie.name,
        secret: cookie.value,
        label: row?.name ?? `Key ${apiKeyId.slice(0, 8)}`,
      },
    ]
  })
  const error = typeof sp.error === 'string' ? sp.error : undefined

  const h = await headers()
  const host = h.get('host') ?? 'your-host'
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}/api/v1`

  const now = nowDate.getTime()

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title={tGenerated('m_100ad61f23e3c3')}
          subtitle={tGenerated('m_0c0529edc503cf')}
        />

        <GeneratedValue
          value={reveals.map((reveal) => (
            <Alert key={reveal.cookieName} variant="warning">
              <AlertTitle>
                <GeneratedText id="m_17e5ebd91b9a4f" /> <GeneratedValue value={reveal.label} />{' '}
                <GeneratedText id="m_13d1df31a4a123" />
              </AlertTitle>
              <AlertDescription className="mt-2 flex items-center justify-between gap-2">
                <code className="block flex-1 overflow-x-auto rounded bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300">
                  {reveal.secret}
                </code>
                <form action={dismissReveal}>
                  <input type="hidden" name="cookieName" value={reveal.cookieName} />
                  <Button type="submit" variant="outline" size="sm">
                    <GeneratedText id="m_13e64df149eaba" />
                  </Button>
                </form>
              </AlertDescription>
            </Alert>
          ))}
        />

        <GeneratedValue
          value={
            error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <GeneratedValue value={error} />
              </div>
            ) : null
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_1d0df07e8599e0" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <GeneratedText id="m_07585a641ed71e" />
              </div>
              <code className="block w-fit rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {baseUrl}
              </code>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <GeneratedText id="m_1301c29e1581dc" />
              <GeneratedValue value={' '} />
              <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code>
              <GeneratedText id="m_000f83dccdbfbf" />
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/api/v1/docs" target="_blank" rel="noreferrer" className={DOC_LINK_CLASS}>
                <BookText size={14} /> <GeneratedText id="m_09bedcc06eba6d" />
              </a>
              <a
                href="/api/v1/openapi.json"
                target="_blank"
                rel="noreferrer"
                className={DOC_LINK_CLASS}
              >
                <Download size={14} /> <GeneratedText id="m_0a58d87e99a43e" />
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_1e6054dc08562f" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createApiKey} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_02b18d5c7f6f2d" />
                  </Label>
                  <Input name="name" required placeholder={tGenerated('m_15427f3611a133')} />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_1977d5e7826151" />
                  </Label>
                  <Input type="date" name="expiresAt" />
                </div>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  <GeneratedText id="m_0f16ebbc2ed672" />
                </legend>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_068e65729eb69b" />
                </p>
                <PermissionMatrix />
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  <GeneratedText id="m_161e4f441da198" />
                </legend>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_17144d31fa030e" />
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <GeneratedValue
                    value={builderApps.map((app) => (
                      <label key={app.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="builderTemplateIds" value={app.id} />
                        <span>
                          <GeneratedValue value={app.name} />
                        </span>
                      </label>
                    ))}
                  />
                </div>
              </fieldset>

              <Button type="submit">
                <Key size={14} /> <GeneratedText id="m_1dbb9f90b1c6f2" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <TableToolbar>
          <SearchInput placeholder={tGenerated('m_0d2dd439687b7d')} />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="status"
            label={tGenerated('m_0b9da892d6faf0')}
            options={[
              { value: 'active', label: 'Active', count: list.statusCounts.active },
              { value: 'expired', label: 'Expired', count: list.statusCounts.expired },
              { value: 'revoked', label: 'Revoked', count: list.statusCounts.revoked },
            ]}
          />
        </TableToolbar>

        <GeneratedValue
          value={
            list.rows.length === 0 ? (
              <EmptyState
                icon={<Key size={32} />}
                title={tGeneratedValue(
                  !params.q && !statusFilter
                    ? tGenerated('m_00d7c8efa838bf')
                    : tGenerated('m_018fe15cc7c866'),
                )}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="name"
                      active={params.sort === 'name'}
                    >
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_0f16ebbc2ed672" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_00adfbfb276db4" />
                    </TableHead>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="created"
                      active={params.sort === 'created'}
                    >
                      <GeneratedText id="m_10cbe051fb5e05" />
                    </SortableTh>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="expires"
                      active={params.sort === 'expires'}
                    >
                      <GeneratedText id="m_14f3858b0a9ad6" />
                    </SortableTh>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="lastUsed"
                      active={params.sort === 'lastUsed'}
                    >
                      <GeneratedText id="m_0d0ec4c8965d4c" />
                    </SortableTh>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="status"
                      active={params.sort === 'status'}
                    >
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortableTh>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={list.rows.map((k) => {
                      const expired = !k.revokedAt && k.expiresAt && k.expiresAt.getTime() <= now
                      return (
                        <TableRow key={k.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/admin/api-keys/${k.id}` as any}
                              className="text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={k.name} />
                            </Link>
                          </TableCell>
                          <TableCell>
                            <GeneratedValue value={permissionSummary(k.permissions ?? [])} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <GeneratedValue value={k.prefix} />…
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={formatDate(new Date(k.createdAt), ctx.timezone, ctx.locale)}
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={
                                k.expiresAt
                                  ? formatDate(new Date(k.expiresAt), ctx.timezone, ctx.locale)
                                  : '—'
                              }
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={
                                k.lastUsedAt
                                  ? formatDateTime(new Date(k.lastUsedAt), ctx.timezone, ctx.locale)
                                  : '—'
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                k.revokedAt ? (
                                  <Badge variant="destructive">
                                    <GeneratedText id="m_0546f73f095668" />
                                  </Badge>
                                ) : expired ? (
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    <GeneratedText id="m_0f5dff2d717856" />
                                  </span>
                                ) : (
                                  <Badge variant="success">
                                    <GeneratedText id="m_0af64d5dc843c0" />
                                  </Badge>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                !k.revokedAt ? (
                                  <form action={revokeApiKey} className="inline">
                                    <input type="hidden" name="id" value={k.id} />
                                    <Button type="submit" size="sm" variant="outline">
                                      <GeneratedText id="m_18718dd379a57d" />
                                    </Button>
                                  </form>
                                ) : null
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
                </TableBody>
              </Table>
            )
          }
        />
        <Pagination
          basePath={BASE}
          currentParams={sp}
          total={list.total}
          page={params.page}
          perPage={params.perPage}
        />
      </div>
    </PageContainer>
  )
}
