import { createHash, randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { apiKeys, formTemplates } from '@beaconhs/db/schema'
import { assertNotImpersonating } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { sanitizeApiPermissions } from '@/lib/api/permissions'
import { requireApiKeyAdmin } from './_guard'

export const REVEAL_COOKIE = 'bhs-api-key-reveal'

/** Mutations additionally refuse impersonated sessions — an admin "viewing as"
 *  someone must not mint or edit credentials. */
async function requireApiKeyWriter() {
  const ctx = await requireApiKeyAdmin()
  assertNotImpersonating(ctx, 'manage API keys')
  return ctx
}

function readPermissions(formData: FormData): string[] {
  return sanitizeApiPermissions(formData.getAll('permissions').map(String))
}

async function readBuilderTemplateIds(
  ctx: Awaited<ReturnType<typeof requireApiKeyWriter>>,
  formData: FormData,
): Promise<string[]> {
  const requested = [...new Set(formData.getAll('builderTemplateIds').map(String))].filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  )
  if (requested.length === 0) return []
  const rows = await ctx.db((tx) =>
    tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(
        and(
          inArray(formTemplates.id, requested),
          eq(formTemplates.status, 'published'),
          isNull(formTemplates.deletedAt),
        ),
      ),
  )
  if (rows.length !== requested.length)
    throw new Error('One or more Builder app grants are invalid')
  return rows.map((row) => row.id)
}

// Date-only input, anchored to end-of-day UTC so it round-trips exactly with
// the edit form's `toISOString().slice(0, 10)` display. Parsing in server-local
// time made the shown date drift forward a day per save on any server west of
// UTC.
function parseExpiresAt(formData: FormData): Date | null {
  const raw = String(formData.get('expiresAt') ?? '').trim()
  if (!raw) return null
  const parsed = new Date(`${raw}T23:59:59Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function createApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyWriter()
  const name = String(formData.get('name') ?? '').trim()
  const permissions = readPermissions(formData)
  const builderTemplateIds = await readBuilderTemplateIds(ctx, formData)

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
        builderTemplateIds,
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
      after: { name, permissions, builderTemplateIds, expiresAt: row.expiresAt },
    })
  }

  const cookieStore = await cookies()
  cookieStore.set(REVEAL_COOKIE, secret, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/admin/api-keys',
    maxAge: 60,
  })
  revalidatePath('/admin/api-keys')
}

export async function updateApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyWriter()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const name = String(formData.get('name') ?? '').trim()
  const permissions = readPermissions(formData)
  const builderTemplateIds = await readBuilderTemplateIds(ctx, formData)
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
    tx
      .update(apiKeys)
      .set({ name, permissions, builderTemplateIds, expiresAt })
      .where(eq(apiKeys.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'api_key',
    entityId: id,
    action: 'update',
    summary: `Updated API key "${name}"`,
    before: {
      name: before.name,
      permissions: before.permissions,
      builderTemplateIds: before.builderTemplateIds,
      expiresAt: before.expiresAt,
      revokedAt: before.revokedAt,
    },
    after: { name, permissions, builderTemplateIds, expiresAt },
  })
  revalidatePath('/admin/api-keys')
  revalidatePath(`/admin/api-keys/${id}`)
}

export async function revokeApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyWriter()
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
