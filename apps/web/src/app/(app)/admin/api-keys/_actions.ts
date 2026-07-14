import { createHash, randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { apiKeys, formTemplates } from '@beaconhs/db/schema'
import { assertNotImpersonating } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { requireApiKeyAdmin } from './_guard'
import {
  readApiKeyExpiresAt,
  readApiKeyId,
  readApiKeyName,
  readApiKeyPermissions,
  readBuilderTemplateGrantIds,
} from './_mutation-input'
import { apiKeyIdFromRevealCookie, apiKeyRevealCookieName } from './_reveal-cookie'

/** Mutations additionally refuse impersonated sessions — an admin "viewing as"
 *  someone must not mint or edit credentials. */
async function requireApiKeyWriter() {
  const ctx = await requireApiKeyAdmin()
  assertNotImpersonating(ctx, 'manage API keys')
  return ctx
}

class ApiKeyMutationError extends Error {}

async function validateBuilderTemplateIds(tx: Database, requested: string[]): Promise<void> {
  if (requested.length === 0) return
  const rows = await tx
    .select({ id: formTemplates.id })
    .from(formTemplates)
    .where(
      and(
        inArray(formTemplates.id, requested),
        eq(formTemplates.status, 'published'),
        isNull(formTemplates.deletedAt),
      ),
    )
    .for('share')
  if (rows.length !== requested.length) {
    throw new ApiKeyMutationError('One or more Builder app grants are no longer available.')
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const normalizedLeft = [...left].sort()
  const normalizedRight = [...right].sort()
  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The API key details are invalid.'
}

export async function createApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyWriter()
  let name: string
  let permissions: string[]
  let builderTemplateIds: string[]
  let expiresAt: Date | null
  try {
    name = readApiKeyName(formData)
    permissions = readApiKeyPermissions(formData)
    builderTemplateIds = readBuilderTemplateGrantIds(formData)
    expiresAt = readApiKeyExpiresAt(formData)
  } catch (error) {
    redirect(`/admin/api-keys?error=${encodeURIComponent(errorMessage(error))}`)
  }
  if (permissions.length === 0) {
    redirect(`/admin/api-keys?error=${encodeURIComponent('Choose at least one permission.')}`)
  }

  const secret = `bhs_live_${randomBytes(32).toString('base64url')}`
  const keyHash = createHash('sha256').update(secret).digest('hex')
  const prefix = secret.slice(0, 12)
  let createdKeyId: string
  try {
    createdKeyId = await ctx.db(async (tx) => {
      await validateBuilderTemplateIds(tx, builderTemplateIds)
      const [created] = await tx
        .insert(apiKeys)
        .values({
          tenantId: ctx.tenantId,
          name,
          keyHash,
          prefix,
          permissions,
          builderTemplateIds,
          expiresAt,
          createdBy: ctx.userId,
        })
        .returning()
      if (!created) throw new Error('API key could not be created.')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'api_key',
        entityId: created.id,
        action: 'create',
        summary: `Created API key "${name}"`,
        after: { name, permissions, builderTemplateIds, expiresAt: created.expiresAt },
      })
      return created.id
    })
  } catch (error) {
    if (error instanceof ApiKeyMutationError) {
      redirect(`/admin/api-keys?error=${encodeURIComponent(error.message)}`)
    }
    throw error
  }

  const cookieStore = await cookies()
  cookieStore.set(apiKeyRevealCookieName(createdKeyId), secret, {
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
  let id: string
  try {
    id = readApiKeyId(formData)
  } catch (error) {
    redirect(`/admin/api-keys?error=${encodeURIComponent(errorMessage(error))}`)
  }
  const errorPath = `/admin/api-keys/${id}`
  let name: string
  let permissions: string[]
  let builderTemplateIds: string[]
  let expiresAt: Date | null
  try {
    name = readApiKeyName(formData)
    permissions = readApiKeyPermissions(formData)
    builderTemplateIds = readBuilderTemplateGrantIds(formData)
    expiresAt = readApiKeyExpiresAt(formData)
  } catch (error) {
    redirect(`${errorPath}?error=${encodeURIComponent(errorMessage(error))}`)
  }
  if (permissions.length === 0) {
    redirect(`${errorPath}?error=${encodeURIComponent('Choose at least one permission.')}`)
  }

  let outcome: 'changed' | 'unchanged' | 'revoked'
  try {
    outcome = await ctx.db(async (tx) => {
      const [before] = await tx
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, id))
        .for('update')
        .limit(1)
      if (!before) throw new Error('API key not found.')
      if (before.revokedAt) return 'revoked'
      await validateBuilderTemplateIds(tx, builderTemplateIds)

      if (
        before.name === name &&
        sameStrings(before.permissions, permissions) &&
        sameStrings(before.builderTemplateIds, builderTemplateIds) &&
        sameInstant(before.expiresAt, expiresAt)
      ) {
        return 'unchanged'
      }

      const [updated] = await tx
        .update(apiKeys)
        .set({ name, permissions, builderTemplateIds, expiresAt })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id })
      if (!updated) throw new Error('API key could not be updated.')
      await recordAuditInTransaction(tx, ctx, {
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
      return 'changed'
    })
  } catch (error) {
    if (error instanceof ApiKeyMutationError) {
      redirect(`${errorPath}?error=${encodeURIComponent(error.message)}`)
    }
    throw error
  }
  if (outcome === 'revoked') {
    redirect(`${errorPath}?error=${encodeURIComponent('Revoked API keys cannot be edited.')}`)
  }
  if (outcome === 'unchanged') return
  revalidatePath('/admin/api-keys')
  revalidatePath(`/admin/api-keys/${id}`)
}

export async function revokeApiKey(formData: FormData) {
  'use server'
  const ctx = await requireApiKeyWriter()
  let id: string
  try {
    id = readApiKeyId(formData)
  } catch (error) {
    redirect(`/admin/api-keys?error=${encodeURIComponent(errorMessage(error))}`)
  }

  const changed = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .for('update')
      .limit(1)
    if (!before) throw new Error('API key not found.')
    if (before.revokedAt) return false

    const revokedAt = new Date()
    const [revoked] = await tx
      .update(apiKeys)
      .set({ revokedAt })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id })
    if (!revoked) throw new Error('API key could not be revoked.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'api_key',
      entityId: id,
      action: 'update',
      summary: `Revoked API key "${before.name}"`,
      before: { name: before.name, permissions: before.permissions, revokedAt: null },
      after: { revokedAt },
    })
    return true
  })
  if (!changed) return
  revalidatePath('/admin/api-keys')
  revalidatePath(`/admin/api-keys/${id}`)
}

export async function dismissReveal(formData: FormData) {
  'use server'
  const cookieName = formData.get('cookieName')
  if (typeof cookieName !== 'string' || !apiKeyIdFromRevealCookie(cookieName)) return
  const cookieStore = await cookies()
  cookieStore.delete(cookieName)
  revalidatePath('/admin/api-keys')
}
