'use server'

import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { formAutomations, formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import { validateFormSchema, type AutomationGraph, type FormSchemaV1 } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import type { RecordConfig } from './_record-behavior-panel'

// Records-list configuration (recordConfig.list). The CONTRACT mirrors the
// records page (apps/templates/[id]/records) exactly — keep them in lockstep.
//   • columns    — ordered display columns; empty/absent ⇒ default columns.
//   • defaultSort — initial sort (sortable builtins only).
//   • defaultStatus — initial status filter; '' = none.
export type ListColumnConfig = { key: string; source: 'builtin' | 'field'; label?: string }
export type ListConfig = {
  columns?: ListColumnConfig[]
  defaultSort?: { key: 'submitted_at' | 'created_at' | 'status'; dir: 'asc' | 'desc' }
  defaultStatus?: string
}

// A sensible, editable default flow seeded for monitored apps so an overdue
// check-in is never silent. Alerting stays flow-driven (per-tenant, editable in
// the canvas) — a default, not hardcoded special treatment.
function defaultOverdueFlowGraph(): AutomationGraph {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'trg',
        position: { x: 60, y: 80 },
        data: { kind: 'trigger', trigger: { trigger: 'session_overdue' } },
      },
      {
        id: 'act',
        position: { x: 380, y: 80 },
        data: {
          kind: 'action',
          action: {
            action: 'notify_role',
            role: 'safety_manager',
            message: 'A monitored session check-in is overdue — follow up now.',
            channel: 'in_app',
          },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trg', target: 'act', sourceHandle: 'next' }],
  }
}

export async function publishNewVersion(args: {
  templateId: string
  schema: FormSchemaV1
  changelog: string
}): Promise<{ ok: boolean; version?: number; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.publish')
  try {
    const validated = validateFormSchema(args.schema)
    const result = await ctx.db(async (tx) => {
      const [latest] = await tx
        .select({ v: formTemplateVersions.version })
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, args.templateId))
        .orderBy(desc(formTemplateVersions.version))
        .limit(1)
      const nextVersion = (latest?.v ?? 0) + 1
      await tx.insert(formTemplateVersions).values({
        tenantId: ctx.tenantId,
        templateId: args.templateId,
        version: nextVersion,
        schema: validated,
        changelog: args.changelog || `Version ${nextVersion}`,
        publishedAt: new Date(),
        publishedBy: ctx.userId,
      })
      await tx
        .update(formTemplates)
        .set({ status: 'published' })
        .where(eq(formTemplates.id, args.templateId))

      // Monitored app? Ensure an overdue-alert flow exists so a missed check-in
      // never escalates silently. Seed a sensible default ONCE (the tenant edits
      // or replaces it in the flow canvas).
      if (validated.monitor) {
        const flows = await tx
          .select({ graph: formAutomations.graph })
          .from(formAutomations)
          .where(eq(formAutomations.templateId, args.templateId))
        const hasOverdueFlow = flows.some((f) =>
          f.graph?.nodes?.some(
            (n) => n.data.kind === 'trigger' && n.data.trigger.trigger === 'session_overdue',
          ),
        )
        if (!hasOverdueFlow) {
          await tx.insert(formAutomations).values({
            tenantId: ctx.tenantId,
            subjectType: 'form_template',
            subjectKey: args.templateId,
            templateId: args.templateId,
            name: 'Overdue check-in alert',
            enabled: true,
            graph: defaultOverdueFlowGraph(),
          })
        }
      }
      return nextVersion
    })

    await recordAudit(ctx, {
      entityType: 'form_template',
      entityId: args.templateId,
      action: 'publish',
      summary: `Published version ${result}`,
    })

    revalidatePath(`/apps/templates/${args.templateId}`)
    revalidatePath('/apps')
    return { ok: true, version: result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save' }
  }
}

// Update an App's "overview" metadata (name / description / category / icon /
// email-on-submit). Distinct from publishing a new schema version.
export async function updateAppOverview(args: {
  templateId: string
  name: string
  description?: string | null
  category?: string | null
  iconKey?: string | null
  emailOnSubmit?: boolean
  surfaceAsTool?: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')
  const name = (args.name ?? '').trim()
  if (!name) return { ok: false, error: 'Name is required' }
  await ctx.db((tx) =>
    tx
      .update(formTemplates)
      .set({
        name,
        description: args.description?.trim() || null,
        // Only touch category / icon / emailOnSubmit when explicitly provided —
        // the Overview panel no longer edits them, so they must survive saves.
        ...(args.category === undefined
          ? {}
          : { category: (args.category?.trim() || null) as never }),
        ...(args.iconKey === undefined ? {} : { iconKey: args.iconKey?.trim() || null }),
        ...(args.emailOnSubmit === undefined ? {} : { emailOnSubmit: args.emailOnSubmit }),
        ...(args.surfaceAsTool === undefined ? {} : { surfaceAsTool: args.surfaceAsTool }),
        updatedAt: new Date(),
      })
      .where(eq(formTemplates.id, args.templateId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: args.templateId,
    action: 'update',
    summary: 'Updated app overview',
  })
  revalidatePath(`/apps/templates/${args.templateId}`)
  revalidatePath('/apps')
  return { ok: true }
}

// Save how a record built from this App behaves once created — its editing mode
// (guided wizard vs. inline autosave) and record locking rules. Stored in the
// jsonb `recordConfig` column; the record page reads it to choose the renderer
// and gate lock/unlock. Mirrors updateAppOverview's assert + tx + audit pattern.
//
// MERGES into the existing recordConfig: only editingMode + locking + tabs are
// written here, so the List-tab config (recordConfig.list) and any other keys
// survive. `tabs` carries the per-app system-tab toggles (pending review,
// comments, audit) the record page reads; only the keys present in the payload
// are written, so unsaved toggles keep their stored value.
export async function updateRecordBehavior(args: {
  templateId: string
  recordConfig: RecordConfig
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')
  await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ recordConfig: formTemplates.recordConfig })
      .from(formTemplates)
      .where(eq(formTemplates.id, args.templateId))
      .limit(1)
    const current = (row?.recordConfig ?? {}) as Record<string, unknown>
    const currentTabs = (current.tabs ?? {}) as Record<string, unknown>
    await tx
      .update(formTemplates)
      .set({
        recordConfig: {
          ...current,
          editingMode: args.recordConfig.editingMode,
          locking: args.recordConfig.locking,
          ...(args.recordConfig.tabs === undefined
            ? {}
            : { tabs: { ...currentTabs, ...args.recordConfig.tabs } }),
        } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(formTemplates.id, args.templateId))
  })
  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: args.templateId,
    action: 'update',
    summary: 'Updated record behaviour',
  })
  revalidatePath(`/apps/templates/${args.templateId}`)
  revalidatePath('/apps')
  return { ok: true }
}

// Configure the records LIST table for this App — the columns shown (ordered),
// the default sort, and the default status filter on /apps/templates/[id]/records.
// Stored under recordConfig.list (jsonb); the records page reads it to build the
// table. MERGES so editingMode/locking (and any other keys) survive. Mirrors the
// assert + tx + audit pattern above.
export async function updateListConfig(input: {
  templateId: string
  list: ListConfig
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')
  await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ recordConfig: formTemplates.recordConfig })
      .from(formTemplates)
      .where(eq(formTemplates.id, input.templateId))
      .limit(1)
    const current = (row?.recordConfig ?? {}) as Record<string, unknown>
    await tx
      .update(formTemplates)
      .set({
        recordConfig: { ...current, list: input.list } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(formTemplates.id, input.templateId))
  })
  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: input.templateId,
    action: 'update',
    summary: 'Updated records list',
  })
  revalidatePath(`/apps/templates/${input.templateId}`)
  revalidatePath('/apps')
  return { ok: true }
}

// Restrict (or open up) which roles may see + fill an App. Empty array ⇒
// visible to everyone.
export async function updateAppPermissions(args: {
  templateId: string
  allowedRoles: string[]
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')
  const roles = Array.from(new Set((args.allowedRoles ?? []).map((r) => r.trim()).filter(Boolean)))
  await ctx.db((tx) =>
    tx
      .update(formTemplates)
      .set({ allowedRoles: roles.length ? roles : null, updatedAt: new Date() })
      .where(eq(formTemplates.id, args.templateId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: args.templateId,
    action: 'update',
    summary: roles.length ? `Restricted to roles: ${roles.join(', ')}` : 'Opened to all roles',
  })
  revalidatePath(`/apps/templates/${args.templateId}`)
  revalidatePath('/apps')
  return { ok: true }
}
