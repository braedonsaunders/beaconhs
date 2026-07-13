'use server'

// Generic flow CRUD for ANY subject (form templates + native modules). The same
// FlowsCanvas calls these; authorization branches on the subject — forms gate on
// forms.template.create, modules on their Manage permission.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import {
  emptyAutomationGraph,
  lintAutomationGraph,
  lintWorkerTriggerCompatibility,
  type AutomationGraph,
} from '@beaconhs/forms-core'
import { can, type RequestContext } from '@beaconhs/tenant'
import { formAutomations, formTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import {
  normalizeFlowName,
  parseFlowGraph,
  parseFlowSubject,
  type FlowSubjectRef,
} from './flow-policy'
import { moduleFlowProfile } from './module-profiles'

export type { FlowSubjectRef } from './flow-policy'

type StoredFlow = FlowSubjectRef & {
  name: string
  enabled: boolean
  graph: AutomationGraph
}

function authorizeSubject(ctx: RequestContext, subject: FlowSubjectRef): boolean {
  if (ctx.isSuperAdmin) return true
  if (subject.type === 'form_template') return can(ctx, 'forms.template.create')
  if (subject.type === 'module') return canManageModule(ctx, subject.key)
  return false
}

async function loadSubject(ctx: RequestContext, flowId: string): Promise<StoredFlow | null> {
  if (!isUuid(flowId)) return null
  const [f] = await ctx.db((tx) =>
    tx
      .select({
        subjectType: formAutomations.subjectType,
        subjectKey: formAutomations.subjectKey,
        templateId: formAutomations.templateId,
        name: formAutomations.name,
        enabled: formAutomations.enabled,
        graph: formAutomations.graph,
      })
      .from(formAutomations)
      .where(eq(formAutomations.id, flowId))
      .limit(1),
  )
  if (!f) return null
  const subject = parseFlowSubject({ type: f.subjectType, key: f.subjectKey ?? f.templateId ?? '' })
  return subject ? { ...subject, name: f.name, enabled: f.enabled, graph: f.graph } : null
}

async function subjectExists(ctx: RequestContext, subject: FlowSubjectRef): Promise<boolean> {
  if (subject.type === 'module') return Boolean(moduleFlowProfile(subject.key))
  const [template] = await ctx.db((tx) =>
    tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(and(eq(formTemplates.id, subject.key), isNull(formTemplates.deletedAt)))
      .limit(1),
  )
  return Boolean(template)
}

function revalidateFlowSubject(subject: FlowSubjectRef): void {
  if (subject.type === 'form_template') {
    revalidatePath(`/apps/templates/${subject.key}/designer`)
    return
  }
  const moduleConfig = moduleAdminByKey(subject.key)
  const flowsPath = moduleConfig?.sections.find((section) => section.key === 'flows')?.href
  if (flowsPath) revalidatePath(flowsPath)
  if (moduleConfig) revalidatePath(moduleConfig.managePath)
}

function validateGraphForSubject(
  subject: FlowSubjectRef,
  value: unknown,
): { ok: true; graph: AutomationGraph } | { ok: false; error: string } {
  const parsed = parseFlowGraph(value)
  if (!parsed.ok) return parsed
  const compatibilityErrors = lintWorkerTriggerCompatibility(parsed.graph)
  if (compatibilityErrors.length > 0) return { ok: false, error: compatibilityErrors[0]! }
  if (subject.type === 'module') {
    const profile = moduleFlowProfile(subject.key)
    if (!profile) return { ok: false, error: 'Flow subject not found' }
    const errors = lintAutomationGraph(
      parsed.graph,
      new Set(profile.fields.map((field) => field.key)),
      profile,
    )
    if (errors.length > 0) return { ok: false, error: errors[0]! }
  }
  return parsed
}

export async function createFlow(
  requestedSubject: FlowSubjectRef,
  name?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const subject = parseFlowSubject(requestedSubject)
  if (!subject || !(await subjectExists(ctx, subject))) {
    return { ok: false, error: 'Flow subject not found' }
  }
  if (!authorizeSubject(ctx, subject)) return { ok: false, error: 'Not authorized' }
  const flowName = normalizeFlowName(name)

  const [row] = await ctx.db((tx) =>
    tx
      .insert(formAutomations)
      .values({
        tenantId: ctx.tenantId,
        subjectType: subject.type,
        subjectKey: subject.key,
        templateId: subject.type === 'form_template' ? subject.key : null,
        name: flowName,
        enabled: false,
        graph: emptyAutomationGraph(),
      })
      .returning({ id: formAutomations.id }),
  )
  if (!row) return { ok: false, error: 'Flow could not be created' }
  await recordAudit(ctx, {
    entityType: 'form_automation',
    entityId: row.id,
    action: 'create',
    summary: `Created flow "${flowName}"`,
    after: { subjectType: subject.type, subjectKey: subject.key, name: flowName, enabled: false },
  })
  revalidateFlowSubject(subject)
  return { ok: true, id: row?.id }
}

export async function saveFlow(
  flowId: string,
  graph: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject) return { ok: false, error: 'Flow not found' }
  if (!authorizeSubject(ctx, subject)) return { ok: false, error: 'Not authorized' }

  const parsed = validateGraphForSubject(subject, graph)
  if (!parsed.ok) return parsed
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ graph: parsed.graph, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_automation',
    entityId: flowId,
    action: 'update',
    summary: `Updated flow "${subject.name}"`,
    metadata: { nodes: parsed.graph.nodes.length, edges: parsed.graph.edges.length },
  })
  revalidateFlowSubject(subject)
  return { ok: true }
}

export async function renameFlow(flowId: string, name: string): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject || !authorizeSubject(ctx, subject)) return { ok: false }
  const flowName = normalizeFlowName(name)
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ name: flowName, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_automation',
    entityId: flowId,
    action: 'update',
    summary: `Renamed flow to "${flowName}"`,
    before: { name: subject.name },
    after: { name: flowName },
  })
  revalidateFlowSubject(subject)
  return { ok: true }
}

export async function setFlowEnabled(flowId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject || !authorizeSubject(ctx, subject) || typeof enabled !== 'boolean') {
    return { ok: false }
  }
  if (enabled && !validateGraphForSubject(subject, subject.graph).ok) return { ok: false }
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_automation',
    entityId: flowId,
    action: 'update',
    summary: `${enabled ? 'Enabled' : 'Disabled'} flow "${subject.name}"`,
    before: { enabled: subject.enabled },
    after: { enabled },
  })
  revalidateFlowSubject(subject)
  return { ok: true }
}

export async function deleteFlow(flowId: string): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject || !authorizeSubject(ctx, subject)) return { ok: false }
  await ctx.db((tx) => tx.delete(formAutomations).where(eq(formAutomations.id, flowId)))
  await recordAudit(ctx, {
    entityType: 'form_automation',
    entityId: flowId,
    action: 'delete',
    summary: `Deleted flow "${subject.name}"`,
    before: {
      subjectType: subject.type,
      subjectKey: subject.key,
      name: subject.name,
      enabled: subject.enabled,
    },
  })
  revalidateFlowSubject(subject)
  return { ok: true }
}
