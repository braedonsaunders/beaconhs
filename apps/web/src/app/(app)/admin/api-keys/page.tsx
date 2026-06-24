import { revalidatePath } from 'next/cache'
import { randomBytes, createHash } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
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
import { can } from '@beaconhs/tenant'
import { apiKeys } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { API_SCOPES, READ_ALL_SCOPE, sanitizeScopes } from '@/lib/api/scopes'

export const metadata = { title: 'API keys' }
export const dynamic = 'force-dynamic'

const REVEAL_COOKIE = 'bhs-api-key-reveal'

// Outline-button styling for anchor links (the Button component doesn't render
// as an anchor, so links are styled <a> elements — matching the app's pattern).
const DOC_LINK_CLASS =
  'inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800/60'

/** API keys are a privileged credential — gate the page and every action on
 *  the dedicated permission (super-admins always pass). */
async function requireApiKeyAdmin() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.api-keys.manage')) redirect('/admin')
  return ctx
}

async function createApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyAdmin()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return

  // A key with no scopes is useless — default to full read access.
  let scopes = sanitizeScopes(formData.getAll('scopes').map(String))
  if (scopes.length === 0) scopes = [READ_ALL_SCOPE]

  const expiresRaw = String(formData.get('expiresAt') ?? '').trim()
  const expiresParsed = expiresRaw ? new Date(`${expiresRaw}T23:59:59`) : null
  const expiresAt = expiresParsed && !Number.isNaN(expiresParsed.getTime()) ? expiresParsed : null

  // Generate a secret like `bhs_live_<base64>`. The PLAIN secret is shown
  // once via a short-lived cookie; only the SHA256 hash is stored.
  const secretBytes = randomBytes(32)
  const secret = `bhs_live_${secretBytes.toString('base64url')}`
  const keyHash = createHash('sha256').update(secret).digest('hex')
  const prefix = secret.slice(0, 12)
  const [row] = await ctx.db((tx) =>
    tx
      .insert(apiKeys)
      .values({
        tenantId: ctx.tenantId,
        name,
        keyHash,
        prefix,
        scopes,
        expiresAt,
        createdBy: ctx.userId,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'api_key',
      entityId: row.id,
      action: 'create',
      summary: `Created API key "${name}" (${scopes.join(', ')})`,
    })
  }
  const cookieStore = await cookies()
  cookieStore.set(REVEAL_COOKIE, secret, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin/api-keys',
    maxAge: 60, // one minute to copy it
  })
  revalidatePath('/admin/api-keys')
}

async function revokeApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyAdmin()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id)))
  await recordAudit(ctx, {
    entityType: 'api_key',
    entityId: id,
    action: 'update',
    summary: 'Revoked API key',
  })
  revalidatePath('/admin/api-keys')
}

async function dismissReveal() {
  'use server'
  const cookieStore = await cookies()
  cookieStore.delete(REVEAL_COOKIE)
  revalidatePath('/admin/api-keys')
}

function scopeSummary(scopes: string[]) {
  if (scopes.length === 0) return <span className="text-xs text-slate-400">none</span>
  const readScopes = scopes.filter((s) => s.startsWith('read:'))
  const hasWrite = scopes.some((s) => s.startsWith('write:'))
  const readLabel = scopes.includes(READ_ALL_SCOPE) ? 'Full read' : `${readScopes.length} read`
  return (
    <span className="flex flex-wrap gap-1" title={scopes.join(', ')}>
      {readScopes.length ? (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {readLabel}
        </span>
      ) : null}
      {hasWrite ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          write
        </span>
      ) : null}
    </span>
  )
}

export default async function ApiKeysPage() {
  const ctx = await requireApiKeyAdmin()
  const rows = await ctx.db((tx) => tx.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)))
  const cookieStore = await cookies()
  const reveal = cookieStore.get(REVEAL_COOKIE)?.value ?? null

  const h = await headers()
  const host = h.get('host') ?? 'your-host'
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}/api/v1`

  const now = new Date().getTime()
  const readScopes = API_SCOPES.filter((s) => s.group === 'Read' && s.value !== READ_ALL_SCOPE)
  const writeScopes = API_SCOPES.filter((s) => s.group === 'Write')

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
                  Scopes
                </legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={READ_ALL_SCOPE}
                    defaultChecked
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>Full read access — all data ({READ_ALL_SCOPE})</span>
                </label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {readScopes.map((s) => (
                    <label key={s.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="scopes"
                        value={s.value}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span>{s.label.replace('Read — ', '')}</span>
                    </label>
                  ))}
                </div>
                <div className="space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    Write
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {writeScopes.map((s) => (
                      <label key={s.value} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="scopes"
                          value={s.value}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>{s.label.replace('Write — ', '')}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Pick specific scopes to limit the key, or leave full read access selected. Write
                  scopes allow creating records.
                </p>
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
                <TableHead>Scopes</TableHead>
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
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>{scopeSummary(k.scopes ?? [])}</TableCell>
                    <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}
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
