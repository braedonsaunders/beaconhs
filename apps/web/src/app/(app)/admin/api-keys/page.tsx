import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { desc } from 'drizzle-orm'
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
import { apiKeys } from '@beaconhs/db/schema'
import { PageContainer } from '@/components/page-layout'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { permissionGroupLabel } from '@/lib/permissions-meta'
import { PermissionMatrix } from '../roles/_components/permission-matrix'
import { createApiKey, dismissReveal, REVEAL_COOKIE, revokeApiKey } from './_actions'
import { requireApiKeyAdmin } from './_guard'

export const metadata = { title: 'API keys' }
export const dynamic = 'force-dynamic'

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
  const rows = await ctx.db((tx) => tx.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)))
  const cookieStore = await cookies()
  const reveal = cookieStore.get(REVEAL_COOKIE)?.value ?? null
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined

  const h = await headers()
  const host = h.get('host') ?? 'your-host'
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}/api/v1`

  const now = new Date().getTime()

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="API keys"
          subtitle="Per-tenant secrets for the public REST API"
        />

        {reveal ? (
          <Alert variant="warning">
            <AlertTitle>Copy this key now — it won't be shown again</AlertTitle>
            <AlertDescription className="mt-2 flex items-center justify-between gap-2">
              <code className="block flex-1 overflow-x-auto rounded bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300">
                {reveal}
              </code>
              <form action={dismissReveal}>
                <Button type="submit" variant="outline" size="sm">
                  I've copied it
                </Button>
              </form>
            </AlertDescription>
          </Alert>
        ) : null}

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

              <Button type="submit">
                <Key size={14} /> Generate
              </Button>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <EmptyState icon={<Key size={32} />} title="No API keys" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((k) => {
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
      </div>
    </PageContainer>
  )
}
