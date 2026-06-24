'use server'

// Server actions for /admin/integrations/outbound. Enable + configure an
// outbound integration; secrets are sealed (sealSecret) exactly like sync
// connections. Gated by admin.integrations.manage.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { tenantIntegrations } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { sealSecret, unsealSecret } from '@beaconhs/sync'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { getOutboundIntegration } from '@/lib/integrations'
import type { OutboundIntegrationContext } from '@/lib/integrations'

const PERM = 'admin.integrations.manage'
type Sealed = Record<string, { ciphertext: string; nonce: string }>

async function guard() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, PERM)) return null
  return ctx
}

function unsealAll(secrets: Sealed | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(secrets ?? {})) {
    const plain = unsealSecret(v)
    if (plain != null) out[k] = plain
  }
  return out
}

async function loadRow(ctx: RequestContext, key: string) {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.integrationKey, key), isNull(tenantIntegrations.deletedAt)))
      .limit(1)
    return row ?? null
  })
}

export async function saveOutbound(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const key = String(formData.get('integrationKey') ?? '').trim()
  const def = getOutboundIntegration(key)
  if (!def) return
  const existing = await loadRow(ctx, key)
  const enabled = formData.get('enabled') === 'on' || formData.get('enabled') === 'true'

  const config: Record<string, unknown> = {
    ...((existing?.config as Record<string, unknown>) ?? {}),
  }
  for (const f of def.configFields) {
    const raw = formData.get(f.key)
    if (f.type === 'boolean') {
      config[f.key] = raw === 'on' || raw === 'true'
    } else if (f.type === 'number') {
      const s = String(raw ?? '').trim()
      if (s === '') delete config[f.key]
      else if (!Number.isNaN(Number(s))) config[f.key] = Number(s)
    } else {
      const v = String(raw ?? '').trim()
      if (v === '') delete config[f.key]
      else config[f.key] = v
    }
  }

  // Merge sealed secrets so a blank field keeps the stored value.
  const secrets: Sealed = { ...((existing?.secrets as Sealed) ?? {}) }
  for (const s of def.secretFields) {
    const v = String(formData.get(s.key) ?? '')
    if (v.trim() !== '') secrets[s.key] = sealSecret(v.trim())
  }

  const savedId = await ctx.db(async (tx) => {
    if (existing) {
      await tx
        .update(tenantIntegrations)
        .set({ enabled, config, secrets, status: enabled ? 'ready' : 'disabled' })
        .where(eq(tenantIntegrations.id, existing.id))
      return existing.id
    }
    const [r] = await tx
      .insert(tenantIntegrations)
      .values({
        tenantId: ctx.tenantId,
        integrationKey: key,
        enabled,
        config,
        secrets,
        status: enabled ? 'ready' : 'draft',
      })
      .returning({ id: tenantIntegrations.id })
    return r?.id ?? null
  })

  await recordAudit(ctx, {
    entityType: 'tenant_integration',
    entityId: savedId ?? key,
    action: existing ? 'update' : 'create',
    summary: `${enabled ? 'Enabled' : 'Saved'} integration "${def.name}"`,
  })
  revalidatePath('/admin/integrations/outbound')
}

export async function testOutbound(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const key = String(formData.get('integrationKey') ?? '').trim()
  const def = getOutboundIntegration(key)
  if (!def?.test) return
  const row = await loadRow(ctx, key)
  if (!row) return
  const runCtx: OutboundIntegrationContext = {
    tenantId: ctx.tenantId,
    db: ctx.db,
    config: (row.config as Record<string, unknown>) ?? {},
    secrets: unsealAll(row.secrets as Sealed),
    log: () => {},
  }
  const result = await def
    .test(runCtx)
    .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  await ctx.db((tx) =>
    tx
      .update(tenantIntegrations)
      .set({
        status: result.ok ? 'ready' : 'error',
        lastError: result.ok ? null : (result.error ?? 'Test failed'),
        lastRunAt: new Date(),
      })
      .where(eq(tenantIntegrations.id, row.id)),
  )
  revalidatePath('/admin/integrations/outbound')
}
