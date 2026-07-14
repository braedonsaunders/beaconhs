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

export const metadata = { title: 'API keys' }
export const dynamic = 'force-dynamic'

const BASE = '/admin/api-keys'
const SORTS = ['name', 'created', 'expires', 'lastUsed', 'status'] as const

// Outline-button styling for anchor links (the Button component doesn't render
// as an anchor, so links are styled <a> elements — matching the app's pattern).
const DOC_LINK_CLASS =
  'inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800/60'

function permissionSummary(permissions: string[]) {
  if (permissions.length === 0) return <span className="text-xs text-slate-400">none</span>
  const byGroup = new Map<string, number>()
  for (const permission of permissions) {
    const group = permissionGroupLabel(permission)
    byGroup.set(group, (byGroup.get(group) ?? 0) + 1)
  }
  const entries = [...byGroup.entries()].slice(0, 3)
  return (
    <span className="flex flex-wrap gap-1" title={permissions.join(', ')}>
      {entries.map(([group, count]) => (
        <span
          key={group}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          {group} {count}
        </span>
      ))}
      {byGroup.size > entries.length ? (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          +{byGroup.size - entries.length}
        </span>
      ) : null}
    </span>
  )
}

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
      const statusRank = sql<number>`case when ${apiKeys.revokedAt} is not null then 3 when ${apiKeys.expiresAt} is not null and ${apiKeys.expiresAt} <= ${nowDate} then 2 else 1 end`
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
          title="API keys"
          subtitle="Per-tenant secrets for the public REST API"
        />

        {reveals.map((reveal) => (
          <Alert key={reveal.cookieName} variant="warning">
            <AlertTitle>Copy {reveal.label} now — this secret won't be shown again</AlertTitle>
            <AlertDescription className="mt-2 flex items-center justify-between gap-2">
              <code className="block flex-1 overflow-x-auto rounded bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300">
                {reveal.secret}
              </code>
              <form action={dismissReveal}>
                <input type="hidden" name="cookieName" value={reveal.cookieName} />
                <Button type="submit" variant="outline" size="sm">
                  I've copied it
                </Button>
              </form>
            </AlertDescription>
          </Alert>
        ))}

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Developer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm text-slate-600 dark:text-slate-300">Base URL</div>
              <code className="block w-fit rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {baseUrl}
              </code>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Authenticate with{' '}
              <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code>. The full
              schema is described by the OpenAPI spec and the interactive reference below.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/api/v1/docs" target="_blank" rel="noreferrer" className={DOC_LINK_CLASS}>
                <BookText size={14} /> View API docs
              </a>
              <a
                href="/api/v1/openapi.json"
                target="_blank"
                rel="noreferrer"
                className={DOC_LINK_CLASS}
              >
                <Download size={14} /> OpenAPI spec
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create new key</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createApiKey} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input name="name" required placeholder="e.g. NetSuite integration" />
                </div>
                <div className="space-y-1.5">
                  <Label>Expires (optional)</Label>
                  <Input type="date" name="expiresAt" />
                </div>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Permissions
                </legend>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  API keys use the same permission catalogue as roles. Grant only the permissions
                  this integration needs.
                </p>
                <PermissionMatrix />
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Builder app grants
                </legend>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Forms permissions do not grant every app. Select each published app this key may
                  access. No selection means Builder app access is blocked.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {builderApps.map((app) => (
                    <label key={app.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="builderTemplateIds" value={app.id} />
                      <span>{app.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <Button type="submit">
                <Key size={14} /> Generate
              </Button>
            </form>
          </CardContent>
        </Card>

        <TableToolbar>
          <SearchInput placeholder="Search key name or prefix…" />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="status"
            label="Status"
            options={[
              { value: 'active', label: 'Active', count: list.statusCounts.active },
              { value: 'expired', label: 'Expired', count: list.statusCounts.expired },
              { value: 'revoked', label: 'Revoked', count: list.statusCounts.revoked },
            ]}
          />
        </TableToolbar>

        {list.rows.length === 0 ? (
          <EmptyState
            icon={<Key size={32} />}
            title={!params.q && !statusFilter ? 'No API keys' : 'No matching API keys'}
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
                  Name
                </SortableTh>
                <TableHead>Permissions</TableHead>
                <TableHead>Prefix</TableHead>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="created"
                  active={params.sort === 'created'}
                >
                  Created
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="expires"
                  active={params.sort === 'expires'}
                >
                  Expires
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="lastUsed"
                  active={params.sort === 'lastUsed'}
                >
                  Last used
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="status"
                  active={params.sort === 'status'}
                >
                  Status
                </SortableTh>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((k) => {
                const expired = !k.revokedAt && k.expiresAt && k.expiresAt.getTime() <= now
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/api-keys/${k.id}` as any}
                        className="text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {k.name}
                      </Link>
                    </TableCell>
                    <TableCell>{permissionSummary(k.permissions ?? [])}</TableCell>
                    <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {formatDate(new Date(k.createdAt), ctx.timezone)}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {k.expiresAt ? formatDate(new Date(k.expiresAt), ctx.timezone) : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {k.lastUsedAt ? formatDateTime(new Date(k.lastUsedAt), ctx.timezone) : '—'}
                    </TableCell>
                    <TableCell>
                      {k.revokedAt ? (
                        <Badge variant="destructive">revoked</Badge>
                      ) : expired ? (
                        <span className="text-xs text-slate-500 dark:text-slate-400">expired</span>
                      ) : (
                        <Badge variant="success">active</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!k.revokedAt ? (
                        <form action={revokeApiKey} className="inline">
                          <input type="hidden" name="id" value={k.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Revoke
                          </Button>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
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
