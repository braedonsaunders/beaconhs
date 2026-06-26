import { createHash, randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { apiKeys } from '@beaconhs/db/schema'
import { assertNotImpersonating, can } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { requireRequestContext } from '@/lib/auth'
import { sanitizeApiPermissions } from '@/lib/api/permissions'

export const REVEAL_COOKIE = 'bhs-api-key-reveal'

async function requireApiKeyAdmin() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.api-keys.manage')) redirect('/admin')
  assertNotImpersonating(ctx, 'manage API keys')
  return ctx
}

function readPermissions(formData: FormData): string[] {
  return sanitizeApiPermissions(formData.getAll('permissions').map(String))
}

function parseExpiresAt(formData: FormData): Date | null {
  const raw = String(formData.get('expiresAt') ?? '').trim()
  if (!raw) return null
  const parsed = new Date(`${raw}T23:59:59`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function createApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyAdmin()
  const name = String(formData.get('name') ?? '').trim()
  const permissions = readPermissions(formData)

  if (!name) redirect(`/admin/api-keys?error=${encodeURIComponent('Give the key a name.')}`)
  if (permissions.length === 0) {
    redirect(`/admin/api-keys?error=${encodeURIComponent('Choose at least one permission.')}`)
  }

  const secret = `bhs_live_${randomBytes(32).toString('base64url')}`
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
        permissions,
        expiresAt: parseExpiresAt(formData),
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
      after: { name, permissions, expiresAt: row.expiresAt },
    })
  }

  const cookieStore = await cookies()
  cookieStore.set(REVEAL_COOKIE, secret, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin/api-keys',
    maxAge: 60,
  })
  revalidatePath('/admin/api-keys')
}

export async function updateApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyAdmin()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const name = String(formData.get('name') ?? '').trim()
  const permissions = readPermissions(formData)
  const errorPath = `/admin/api-keys/${id}`
  if (!name) redirect(`${errorPath}?error=${encodeURIComponent('Give the key a name.')}`)
  if (permissions.length === 0) {
    redirect(`${errorPath}?error=${encodeURIComponent('Choose at least one permission.')}`)
  }

  const before = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
    return row ?? null
  })
  if (!before) return
  if (before.revokedAt) {
    redirect(`${errorPath}?error=${encodeURIComponent('Revoked API keys cannot be edited.')}`)
  }

  const expiresAt = parseExpiresAt(formData)
  await ctx.db((tx) =>
    tx.update(apiKeys).set({ name, permissions, expiresAt }).where(eq(apiKeys.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'api_key',
    entityId: id,
    action: 'update',
    summary: `Updated API key "${name}"`,
    before: {
      name: before.name,
      permissions: before.permissions,
      expiresAt: before.expiresAt,
      revokedAt: before.revokedAt,
    },
    after: { name, permissions, expiresAt },
  })
  revalidatePath('/admin/api-keys')
  revalidatePath(`/admin/api-keys/${id}`)
}

export async function revokeApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyAdmin()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
    return row ?? null
  })
  if (!before || before.revokedAt) return

  const revokedAt = new Date()
  await ctx.db((tx) => tx.update(apiKeys).set({ revokedAt }).where(eq(apiKeys.id, id)))
  await recordAudit(ctx, {
    entityType: 'api_key',
    entityId: id,
    action: 'update',
    summary: `Revoked API key "${before.name}"`,
    before: { name: before.name, permissions: before.permissions },
    after: { revokedAt },
  })
  revalidatePath('/admin/api-keys')
  revalidatePath(`/admin/api-keys/${id}`)
}

export async function dismissReveal() {
  'use server'
  const cookieStore = await cookies()
  cookieStore.delete(REVEAL_COOKIE)
  revalidatePath('/admin/api-keys')
}
