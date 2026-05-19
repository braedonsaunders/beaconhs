import { revalidatePath } from 'next/cache'
import { randomBytes, createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { desc, eq } from 'drizzle-orm'
import { Key } from 'lucide-react'
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
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'API keys' }
export const dynamic = 'force-dynamic'

const REVEAL_COOKIE = 'bhs-api-key-reveal'

async function createApiKey(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
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
        createdBy: ctx.userId,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'api_key',
      entityId: row.id,
      action: 'create',
      summary: `Created API key "${name}"`,
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
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id)),
  )
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

export default async function ApiKeysPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)),
  )
  const cookieStore = await cookies()
  const reveal = cookieStore.get(REVEAL_COOKIE)?.value ?? null

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
            <CardTitle>Create new key</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createApiKey} className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Name</Label>
                <Input name="name" required placeholder="e.g. NetSuite integration" />
              </div>
              <Button type="submit">
                <Key size={14} /> Generate
              </Button>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <EmptyState icon={<Key size={32} />} title="No API keys yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    {k.revokedAt ? (
                      <Badge variant="destructive">revoked</Badge>
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
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageContainer>
  )
}
