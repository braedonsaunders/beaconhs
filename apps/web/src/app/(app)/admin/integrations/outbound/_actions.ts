'use server'

// Server actions for a built outbound automation (a tenant_integrations row):
// pick a trigger + destination, configure the connection + mapping, test, save,
// remove. Secrets are sealed (sealSecret) exactly like sync connections. The
// mapping shape is reconstructed per the destination's mappingKind. Gated by
// admin.integrations.manage.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { tenantIntegrations } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { sealSecret, unsealSecret } from '@beaconhs/sync'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { getDestination } from '@beaconhs/integrations'
import type { DestinationDef } from '@beaconhs/integrations'

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

async function loadById(ctx: RequestContext, id: string) {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.id, id), isNull(tenantIntegrations.deletedAt)))
      .limit(1)
    return row ?? null
  })
}

// Read the destination's declared config fields off the form.
function readConfig(
  def: DestinationDef,
  formData: FormData,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const config: Record<string, unknown> = { ...base }
  for (const f of def.configFields) {
    if (f.type === 'boolean') {
      const raw = formData.get(f.key)
      config[f.key] = raw === 'on' || raw === 'true'
      continue
    }
    const raw = formData.get(f.key)
    if (raw == null) continue
    if (f.type === 'number') {
      const s = String(raw).trim()
      if (s === '') delete config[f.key]
      else if (!Number.isNaN(Number(s))) config[f.key] = Number(s)
    } else {
      const v = String(raw).trim()
      if (v === '') delete config[f.key]
      else config[f.key] = v
    }
  }
  return config
}

function readSecrets(def: DestinationDef, formData: FormData, base: Sealed): Sealed {
  const secrets: Sealed = { ...base }
  for (const s of def.secretFields) {
    const v = String(formData.get(s.key) ?? '')
    if (v.trim() !== '') secrets[s.key] = sealSecret(v.trim())
  }
  return secrets
}

// Coerce a literal cell/column value the way a JSON literal would read: a bare
// number/boolean/null keeps its type; anything else (incl. {{tokens}}) is text.
function coerceLiteral(v: string): string | number | boolean | null {
  const t = v.trim()
  if (t === '') return ''
  if (t === 'null') return null
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return v
}

function zipPairs(keys: FormDataEntryValue[], vals: FormDataEntryValue[]): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < keys.length; i++) {
    const k = String(keys[i] ?? '').trim()
    if (k) out.push([k, String(vals[i] ?? '')])
  }
  return out
}

// Reconstruct the destination-specific mapping object from the form.
function readMapping(def: DestinationDef, formData: FormData): Record<string, unknown> {
  switch (def.mappingKind) {
    case 'sql': {
      const cols: Record<string, unknown> = {}
      for (const [k, v] of zipPairs(formData.getAll('col-name'), formData.getAll('col-val'))) {
        cols[k] = coerceLiteral(v)
      }
      return {
        table: String(formData.get('map-table') ?? '').trim(),
        idColumn: String(formData.get('map-idColumn') ?? '').trim(),
        mode: formData.get('map-mode') === 'weekly' ? 'weekly' : 'row',
        departmentMap: String(formData.get('map-departmentMap') ?? ''),
        requireField: String(formData.get('map-requireField') ?? '').trim(),
        columns: cols,
      }
    }
    case 'http': {
      const headers: Record<string, string> = {}
      for (const [k, v] of zipPairs(formData.getAll('hdr-key'), formData.getAll('hdr-val'))) {
        headers[k] = v
      }
      return { headers, body: String(formData.get('map-body') ?? '') }
    }
    case 'slack':
      return {
        text: String(formData.get('map-text') ?? ''),
        blocks: String(formData.get('map-blocks') ?? ''),
      }
    case 'sheets':
      return {
        values: formData
          .getAll('val-expr')
          .map((v) => coerceLiteral(String(v ?? '')))
          .filter((v) => v !== ''),
      }
    case 'email':
      return { body: String(formData.get('map-body') ?? '') }
    default:
      return {}
  }
}

export async function saveOutbound(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '').trim()
  const row = await loadById(ctx, id)
  if (!row) return
  const destinationKey = String(formData.get('destinationKey') ?? row.destinationKey ?? '').trim()
  const def = getDestination(destinationKey)
  if (!def) return

  const name = String(formData.get('name') ?? '').trim() || null
  const triggerKey = String(formData.get('triggerKey') ?? '').trim() || null
  const enabled = formData.get('enabled') === 'on' || formData.get('enabled') === 'true'
  const oncePerRecord =
    formData.get('oncePerRecord') === 'on' || formData.get('oncePerRecord') === 'true'

  const config = readConfig(def, formData, (row.config as Record<string, unknown>) ?? {})
  config.oncePerRecord = oncePerRecord
  config.mapping = readMapping(def, formData)
  const secrets = readSecrets(def, formData, (row.secrets as Sealed) ?? {})

  // Enable only when fully wired.
  const ready = enabled && !!triggerKey && !!destinationKey
  await ctx.db((tx) =>
    tx
      .update(tenantIntegrations)
      .set({
        name,
        triggerKey,
        destinationKey,
        integrationKey: null,
        enabled: ready,
        config,
        secrets,
        status: ready ? 'ready' : 'draft',
      })
      .where(eq(tenantIntegrations.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_integration',
    entityId: id,
    action: 'update',
    summary: `${ready ? 'Enabled' : 'Saved'} automation "${name ?? def.name}"`,
  })
  revalidatePath(`/admin/integrations/outbound/${id}`)
  revalidatePath('/admin/integrations')
}

// Test connectivity using the values currently typed (merged over what's saved).
export async function testOutbound(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const ctx = await guard()
  if (!ctx) return { ok: false, message: 'Not allowed.' }
  const id = String(formData.get('id') ?? '').trim()
  const row = await loadById(ctx, id)
  if (!row) return { ok: false, message: 'Automation not found.' }
  const destinationKey = String(formData.get('destinationKey') ?? row.destinationKey ?? '').trim()
  const def = getDestination(destinationKey)
  if (!def) return { ok: false, message: 'Choose a destination first.' }
  if (!def.test) return { ok: false, message: 'This destination has no test step.' }

  const config = readConfig(def, formData, (row.config as Record<string, unknown>) ?? {})
  const secrets = unsealAll(row.secrets as Sealed)
  for (const s of def.secretFields) {
    const v = String(formData.get(s.key) ?? '')
    if (v.trim() !== '') secrets[s.key] = v.trim()
  }

  const result = await def
    .test({ tenantId: ctx.tenantId, db: ctx.db, config, secrets })
    .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))

  await ctx.db((tx) =>
    tx
      .update(tenantIntegrations)
      .set({
        status: result.ok ? (row.enabled ? 'ready' : 'draft') : 'error',
        lastError: result.ok ? null : (result.error ?? 'Test failed'),
        lastRunAt: new Date(),
      })
      .where(eq(tenantIntegrations.id, id)),
  )
  revalidatePath(`/admin/integrations/outbound/${id}`)
  return {
    ok: result.ok,
    message: result.ok
      ? 'summary' in result && result.summary
        ? result.summary
        : 'Connection successful.'
      : (result.error ?? 'Test failed.'),
  }
}

export async function deleteOutbound(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(tenantIntegrations)
      .set({ deletedAt: new Date(), enabled: false })
      .where(eq(tenantIntegrations.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_integration',
    entityId: id,
    action: 'delete',
    summary: 'Removed outbound automation',
  })
  revalidatePath('/admin/integrations')
  redirect('/admin/integrations')
}
