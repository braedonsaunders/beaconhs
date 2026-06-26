'use server'

// Server actions for /admin/integrations. FormData actions back the server-
// rendered forms; the typed actions are imported by the client islands
// (DB table-browser, Nango connect) and return serialisable results.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@beaconhs/db'
import { syncConnections, tenantIntegrations } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import {
  type ConnectorRunContext,
  getConnector,
  runSync,
  sealSecret,
  unsealSecret,
} from '@beaconhs/sync'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { getDestination } from '@beaconhs/integrations'
import type { RequestContext } from '@beaconhs/tenant'

const PERM = 'admin.integrations.manage'
const noop = () => {}

type Sealed = Record<string, { ciphertext: string; nonce: string }>

async function guard() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, PERM)) return null
  return ctx
}

async function loadConn(ctx: RequestContext, id: string) {
  return ctx.db(async (tx) => {
    const [c] = await tx
      .select()
      .from(syncConnections)
      .where(and(eq(syncConnections.id, id), isNull(syncConnections.deletedAt)))
      .limit(1)
    return c ?? null
  })
}

function unsealAll(secrets: Sealed | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(secrets ?? {})) {
    const plain = unsealSecret(v)
    if (plain != null) out[k] = plain
  }
  return out
}

function buildCtx(
  ctx: RequestContext,
  conn: { id: string; config: unknown; secrets: Sealed },
): ConnectorRunContext {
  return {
    tenantId: ctx.tenantId,
    connectionId: conn.id,
    config: (conn.config as Record<string, unknown>) ?? {},
    secrets: unsealAll(conn.secrets),
    log: noop,
  }
}

// --- FormData actions (server-rendered forms) -----------------------------

export async function createConnection(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const source = String(formData.get('connectorKey') ?? '').trim()

  // Push-out automation — create a fresh tenant_integrations draft for this
  // destination and jump to the builder. Encoded as "outbound:<destinationKey>".
  // Multiple automations per destination are allowed.
  if (source.startsWith('outbound:')) {
    const destinationKey = source.slice('outbound:'.length)
    const dest = getDestination(destinationKey)
    if (!dest) {
      revalidatePath('/admin/integrations')
      return
    }
    const id = await ctx.db(async (tx) => {
      const [row] = await tx
        .insert(tenantIntegrations)
        .values({
          tenantId: ctx.tenantId,
          destinationKey,
          integrationKey: null,
          enabled: false,
          config: {},
          secrets: {},
          status: 'draft',
        })
        .returning({ id: tenantIntegrations.id })
      return row?.id ?? null
    })
    if (id) {
      await recordAudit(ctx, {
        entityType: 'tenant_integration',
        entityId: id,
        action: 'create',
        summary: `Added "Send to ${dest.name}" automation`,
      })
      redirect(`/admin/integrations/outbound/${id}`)
    }
    revalidatePath('/admin/integrations')
    return
  }

  // Sync-in connection.
  const connectorKey = source
  const connector = getConnector(connectorKey)
  if (!connector) {
    revalidatePath('/admin/integrations')
    return
  }
  const name = String(formData.get('name') ?? '').trim() || connector.name
  const newId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(syncConnections)
      .values({
        tenantId: ctx.tenantId,
        connectorKey,
        name,
        status: 'draft',
        config: {},
        secrets: {},
        enabled: false,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: syncConnections.id })
    return row?.id ?? null
  })
  if (newId) {
    await recordAudit(ctx, {
      entityType: 'sync_connection',
      entityId: newId,
      action: 'create',
      summary: `Created ${connectorKey} connection "${name}"`,
      after: { connectorKey, name },
    })
    redirect(`/admin/integrations/${newId}`)
  }
  revalidatePath('/admin/integrations')
}

export async function deleteConnection(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(syncConnections)
      .set({ deletedAt: new Date(), enabled: false })
      .where(eq(syncConnections.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'sync_connection',
    entityId: id,
    action: 'delete',
    summary: 'Deleted sync connection',
  })
  revalidatePath('/admin/integrations')
}

export async function renameConnection(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!id || !name) return
  await ctx.db((tx) => tx.update(syncConnections).set({ name }).where(eq(syncConnections.id, id)))
  await recordAudit(ctx, {
    entityType: 'sync_connection',
    entityId: id,
    action: 'update',
    summary: `Renamed connection to "${name}"`,
  })
  revalidatePath(`/admin/integrations/${id}`)
  revalidatePath('/admin/integrations')
}

export async function saveConfig(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const conn = await loadConn(ctx, id)
  if (!conn) return
  const connector = getConnector(conn.connectorKey)
  if (!connector) return

  const config: Record<string, unknown> = { ...(conn.config as Record<string, unknown>) }
  for (const f of connector.configFields ?? []) {
    const raw = formData.get(f.key)
    if (f.type === 'boolean') {
      config[f.key] = raw === 'on' || raw === 'true'
    } else if (f.type === 'number') {
      const n = Number(String(raw ?? '').trim())
      if (String(raw ?? '').trim() === '') delete config[f.key]
      else if (!Number.isNaN(n)) config[f.key] = n
    } else {
      const v = String(raw ?? '').trim()
      if (v === '') delete config[f.key]
      else config[f.key] = v
    }
  }

  const secrets: Sealed = { ...(conn.secrets as Sealed) }
  for (const s of connector.secretFields ?? []) {
    const v = String(formData.get(s.key) ?? '')
    if (v.trim() !== '') secrets[s.key] = sealSecret(v.trim())
  }

  await ctx.db((tx) =>
    tx.update(syncConnections).set({ config, secrets }).where(eq(syncConnections.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'sync_connection',
    entityId: id,
    action: 'update',
    summary: 'Updated connection settings',
  })
  revalidatePath(`/admin/integrations/${id}`)
}

export async function saveSchedule(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const scheduleRaw = String(formData.get('schedule') ?? '').trim()
  const schedule = scheduleRaw === '' || scheduleRaw === 'manual' ? null : scheduleRaw
  const enabled =
    (formData.get('enabled') === 'on' || formData.get('enabled') === 'true') && !!schedule
  await ctx.db((tx) =>
    tx.update(syncConnections).set({ schedule, enabled }).where(eq(syncConnections.id, id)),
  )
  revalidatePath(`/admin/integrations/${id}`)
}

export async function saveSyncPolicy(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const conn = await loadConn(ctx, id)
  if (!conn) return
  const missingRaw = String(formData.get('missing') ?? 'keep')
  const ownershipRaw = String(formData.get('ownership') ?? 'source_wins')
  const syncPolicy = {
    missing: missingRaw === 'archive' ? 'archive' : 'keep',
    ownership: ownershipRaw === 'manual_wins' ? 'manual_wins' : 'source_wins',
  }
  const config: Record<string, unknown> = {
    ...(conn.config as Record<string, unknown>),
    syncPolicy,
  }
  await ctx.db((tx) => tx.update(syncConnections).set({ config }).where(eq(syncConnections.id, id)))
  await recordAudit(ctx, {
    entityType: 'sync_connection',
    entityId: id,
    action: 'update',
    summary: 'Updated sync ownership and missing-record policy',
    after: { syncPolicy },
  })
  revalidatePath(`/admin/integrations/${id}`)
}

export async function saveCsv(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const conn = await loadConn(ctx, id)
  if (!conn) return
  const entity = String(formData.get('entity') ?? '').trim()
  const csv = String(formData.get('csv') ?? '')
  const idColumn = String(formData.get('idColumn') ?? '').trim() || undefined
  const config: Record<string, unknown> = {
    ...(conn.config as Record<string, unknown>),
    entity,
    csv,
    idColumn,
  }
  await ctx.db((tx) =>
    tx
      .update(syncConnections)
      .set({ config, status: 'connected' })
      .where(eq(syncConnections.id, id)),
  )
  revalidatePath(`/admin/integrations/${id}`)
}

export async function runNow(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const conn = await loadConn(ctx, id)
  if (!conn) return
  const { scheduledQueue } = await import('@beaconhs/jobs')
  await scheduledQueue.add('sync_run', {
    kind: 'sync_run',
    tenantId: ctx.tenantId,
    connectionId: id,
    trigger: 'manual',
  })
  await recordAudit(ctx, {
    entityType: 'sync_connection',
    entityId: id,
    action: 'update',
    summary: 'Queued a manual sync run',
  })
  revalidatePath(`/admin/integrations/${id}`)
}

export async function previewNow(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const conn = await loadConn(ctx, id)
  if (!conn) return
  const result = await runSync({
    db,
    tenantId: ctx.tenantId,
    connectionId: id,
    trigger: 'preview',
    dryRun: true,
  })
  await recordAudit(ctx, {
    entityType: 'sync_connection',
    entityId: id,
    action: 'update',
    summary: `Previewed sync run (${result.status})`,
    after: { runId: result.runId, status: result.status, stats: result.stats },
  })
  revalidatePath(`/admin/integrations/${id}`)
}

// --- Typed actions (called from client islands) ---------------------------

export async function testConnection(id: string): Promise<{ ok: boolean; message?: string }> {
  const ctx = await guard()
  if (!ctx) return { ok: false, message: 'Not allowed.' }
  const conn = await loadConn(ctx, id)
  if (!conn) return { ok: false, message: 'Connection not found.' }
  const connector = getConnector(conn.connectorKey)
  if (!connector?.test) return { ok: false, message: 'This connector has no test step.' }
  const result = await connector.test(buildCtx(ctx, conn))
  await ctx.db((tx) =>
    tx
      .update(syncConnections)
      .set({
        status: result.ok ? 'connected' : 'error',
        lastError: result.ok ? null : (result.message ?? null),
      })
      .where(eq(syncConnections.id, id)),
  )
  revalidatePath(`/admin/integrations/${id}`)
  return result
}

export async function introspectConnection(
  id: string,
): Promise<{ ok: boolean; tables?: { name: string; schema?: string }[]; error?: string }> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'Not allowed.' }
  const conn = await loadConn(ctx, id)
  if (!conn) return { ok: false, error: 'Connection not found.' }
  const connector = getConnector(conn.connectorKey)
  if (!connector?.introspect) return { ok: false, error: 'This connector cannot browse tables.' }
  try {
    const { tables } = await connector.introspect(buildCtx(ctx, conn))
    return { ok: true, tables }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function introspectTable(
  id: string,
  table: { name: string; schema?: string },
): Promise<{
  ok: boolean
  columns?: { name: string; type: string; nullable?: boolean }[]
  error?: string
}> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'Not allowed.' }
  const conn = await loadConn(ctx, id)
  if (!conn) return { ok: false, error: 'Connection not found.' }
  const connector = getConnector(conn.connectorKey)
  if (!connector?.introspectTable)
    return { ok: false, error: 'This connector cannot browse columns.' }
  try {
    const { columns } = await connector.introspectTable(buildCtx(ctx, conn), table)
    return { ok: true, columns }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function saveDbMapping(
  id: string,
  mappings: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'Not allowed.' }
  const conn = await loadConn(ctx, id)
  if (!conn) return { ok: false, error: 'Connection not found.' }
  const config: Record<string, unknown> = { ...(conn.config as Record<string, unknown>), mappings }
  await ctx.db((tx) => tx.update(syncConnections).set({ config }).where(eq(syncConnections.id, id)))
  await recordAudit(ctx, {
    entityType: 'sync_connection',
    entityId: id,
    action: 'update',
    summary: 'Updated table/field mappings',
  })
  revalidatePath(`/admin/integrations/${id}`)
  return { ok: true }
}

export async function saveNangoModels(
  id: string,
  models: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'Not allowed.' }
  const conn = await loadConn(ctx, id)
  if (!conn) return { ok: false, error: 'Connection not found.' }
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(models)) if (v && v.trim()) clean[k] = v.trim()
  const config: Record<string, unknown> = {
    ...(conn.config as Record<string, unknown>),
    models: clean,
  }
  await ctx.db((tx) => tx.update(syncConnections).set({ config }).where(eq(syncConnections.id, id)))
  revalidatePath(`/admin/integrations/${id}`)
  return { ok: true }
}

export async function startNangoConnect(
  id: string,
): Promise<{ ok: boolean; sessionToken?: string; error?: string }> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'Not allowed.' }
  const conn = await loadConn(ctx, id)
  if (!conn) return { ok: false, error: 'Connection not found.' }
  const connector = getConnector(conn.connectorKey)
  if (!connector?.startConnect) return { ok: false, error: 'This connector has no connect step.' }
  try {
    const res = await connector.startConnect(buildCtx(ctx, conn))
    return { ok: true, sessionToken: res.sessionToken }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function finishNangoConnect(
  id: string,
  nangoConnectionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'Not allowed.' }
  const conn = await loadConn(ctx, id)
  if (!conn) return { ok: false, error: 'Connection not found.' }
  const config: Record<string, unknown> = {
    ...(conn.config as Record<string, unknown>),
    connectionId: nangoConnectionId,
  }
  await ctx.db((tx) =>
    tx
      .update(syncConnections)
      .set({ config, status: 'connected' })
      .where(eq(syncConnections.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'sync_connection',
    entityId: id,
    action: 'update',
    summary: 'Linked a Nango source',
  })
  revalidatePath(`/admin/integrations/${id}`)
  return { ok: true }
}
