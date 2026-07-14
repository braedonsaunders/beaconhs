'use server'

// Generic flow CRUD for ANY subject (form templates + native modules). The same
// FlowsCanvas calls these; authorization branches on the subject — forms gate on
// forms.template.create, modules on their Manage permission.

import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import {
  emptyAutomationGraph,
  formSchemaV1,
  lintAutomationGraph,
  lintWorkerTriggerCompatibility,
  storesResponseValue,
  type AutomationGraph,
} from '@beaconhs/forms-core'
import { can, type RequestContext } from '@beaconhs/tenant'
import { formAutomations, formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { parseFlowName } from './flow-name-policy'
import { parseFlowGraph, parseFlowSubject, type FlowSubjectRef } from './flow-policy'
import { moduleFlowProfile } from './module-profiles'
import { validateFlowWebhookConfiguration } from './webhook-policy'
import { lintFormFlowGraph } from './form-flow-validation'

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

async function loadFormSchemaForFlow(
  ctx: RequestContext,
  templateId: string,
  publishedOnly: boolean,
) {
  const conditions = [
    eq(formTemplateVersions.templateId, templateId),
    eq(formTemplateVersions.tenantId, ctx.tenantId),
    eq(formTemplates.id, templateId),
    eq(formTemplates.tenantId, ctx.tenantId),
    isNull(formTemplates.deletedAt),
  ]
  if (publishedOnly) {
    conditions.push(eq(formTemplates.status, 'published'))
    conditions.push(isNotNull(formTemplateVersions.publishedAt))
  }
  const [row] = await ctx.db((tx) =>
    tx
      .select({ name: formTemplates.name, schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .innerJoin(formTemplates, eq(formTemplates.id, formTemplateVersions.templateId))
      .where(and(...conditions))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1),
  )
  if (!row) return null
  const schema = formSchemaV1.safeParse(row.schema)
  return schema.success ? { name: row.name, schema: schema.data } : null
}

async function validateCreateResponseTargets(
  ctx: RequestContext,
  graph: AutomationGraph,
): Promise<string | null> {
  const actions = graph.nodes.flatMap((node) =>
    node.data.kind === 'action' && node.data.action.action === 'create_response'
      ? [{ nodeId: node.id, action: node.data.action }]
      : [],
  )
  const targetIds = new Set(actions.map(({ action }) => action.templateId))
  if (targetIds.size > 25) return 'A flow can start no more than 25 distinct target apps.'

  const schemas = new Map<string, Awaited<ReturnType<typeof loadFormSchemaForFlow>>>()
  for (const targetId of targetIds) {
    if (!isUuid(targetId)) return `Start-another-form target "${targetId}" is not valid.`
    schemas.set(targetId, await loadFormSchemaForFlow(ctx, targetId, true))
  }
  for (const { nodeId, action } of actions) {
    const target = schemas.get(action.templateId)
    if (!target) return `Action ${nodeId}: target app is not published or no longer exists.`
    const writable = new Set(
      target.schema.sections.flatMap((section) =>
        section.repeating
          ? []
          : section.fields.filter(storesResponseValue).map((field) => field.id),
      ),
    )
    for (const key of Object.keys(action.prefill ?? {})) {
      if (!writable.has(key)) {
        return `Action ${nodeId}: prefill targets unknown or non-writable field "${key}".`
      }
    }
  }
  return null
}

async function validateGraphForSubject(
  ctx: RequestContext,
  subject: FlowSubjectRef,
  value: unknown,
  publishedOnly: boolean,
): Promise<{ ok: true; graph: AutomationGraph } | { ok: false; error: string }> {
  const parsed = parseFlowGraph(value)
  if (!parsed.ok) return parsed
  if (parsed.graph.nodes.length > 200 || parsed.graph.edges.length > 400) {
    return { ok: false, error: 'Flows support at most 200 nodes and 400 connections.' }
  }
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
  } else {
    const form = await loadFormSchemaForFlow(ctx, subject.key, publishedOnly)
    if (!form) {
      return {
        ok: false,
        error: publishedOnly
          ? 'Publish the app before enabling this flow.'
          : 'The app schema could not be loaded.',
      }
    }
    const errors = lintFormFlowGraph(parsed.graph, subject.key, form.name, form.schema)
    if (errors.length > 0) return { ok: false, error: errors[0]! }
    const targetError = await validateCreateResponseTargets(ctx, parsed.graph)
    if (targetError) return { ok: false, error: targetError }
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
  const parsedName = parseFlowName(name)
  if (!parsedName.ok) return parsedName
  const flowName = parsedName.name

  const row = await ctx.db(async (tx) => {
    const [created] = await tx
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
      .returning({ id: formAutomations.id })
    if (!created) throw new Error('Flow could not be created')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'form_automation',
      entityId: created.id,
      action: 'create',
      summary: `Created flow "${flowName}"`,
      after: {
        subjectType: subject.type,
        subjectKey: subject.key,
        name: flowName,
        enabled: false,
      },
    })
    return created
  })
  revalidateFlowSubject(subject)
  return { ok: true, id: row.id }
}

export async function saveFlow(
  flowId: string,
  graph: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject) return { ok: false, error: 'Flow not found' }
  if (!authorizeSubject(ctx, subject)) return { ok: false, error: 'Not authorized' }

  const parsed = await validateGraphForSubject(ctx, subject, graph, subject.enabled)
  if (!parsed.ok) return parsed
  const webhookValidation = await validateFlowWebhookConfiguration(parsed.graph)
  if (!webhookValidation.ok) return { ok: false, error: webhookValidation.error }
  const updated = await ctx.db(async (tx) => {
    const [row] = await tx
      .update(formAutomations)
      .set({ graph: parsed.graph, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId))
      .returning({ id: formAutomations.id })
    if (!row) return false
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'form_automation',
      entityId: flowId,
      action: 'update',
      summary: `Updated flow "${subject.name}"`,
      metadata: { nodes: parsed.graph.nodes.length, edges: parsed.graph.edges.length },
    })
    return true
  })
  if (!updated) return { ok: false, error: 'Flow not found' }
  revalidateFlowSubject(subject)
  return { ok: true }
}

export async function renameFlow(
  flowId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject) return { ok: false, error: 'Flow not found' }
  if (!authorizeSubject(ctx, subject)) return { ok: false, error: 'Not authorized' }
  const parsedName = parseFlowName(name)
  if (!parsedName.ok) return parsedName
  const flowName = parsedName.name
  const updated = await ctx.db(async (tx) => {
    const [row] = await tx
      .update(formAutomations)
      .set({ name: flowName, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId))
      .returning({ id: formAutomations.id })
    if (!row) return false
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'form_automation',
      entityId: flowId,
      action: 'update',
      summary: `Renamed flow to "${flowName}"`,
      before: { name: subject.name },
      after: { name: flowName },
    })
    return true
  })
  if (!updated) return { ok: false, error: 'Flow not found' }
  revalidateFlowSubject(subject)
  return { ok: true }
}

export async function setFlowEnabled(
  flowId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject || !authorizeSubject(ctx, subject) || typeof enabled !== 'boolean') {
    return { ok: false }
  }
  if (enabled) {
    const graphValidation = await validateGraphForSubject(ctx, subject, subject.graph, true)
    if (!graphValidation.ok) return graphValidation
    const webhookValidation = await validateFlowWebhookConfiguration(graphValidation.graph)
    if (!webhookValidation.ok) return { ok: false, error: webhookValidation.error }
  }
  const updated = await ctx.db(async (tx) => {
    const [row] = await tx
      .update(formAutomations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId))
      .returning({ id: formAutomations.id })
    if (!row) return false
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'form_automation',
      entityId: flowId,
      action: 'update',
      summary: `${enabled ? 'Enabled' : 'Disabled'} flow "${subject.name}"`,
      before: { enabled: subject.enabled },
      after: { enabled },
    })
    return true
  })
  if (!updated) return { ok: false, error: 'Flow not found' }
  revalidateFlowSubject(subject)
  return { ok: true }
}

export async function deleteFlow(flowId: string): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject || !authorizeSubject(ctx, subject)) return { ok: false }
  const deleted = await ctx.db(async (tx) => {
    const [row] = await tx
      .delete(formAutomations)
      .where(eq(formAutomations.id, flowId))
      .returning({ id: formAutomations.id })
    if (!row) return false
    await recordAuditInTransaction(tx, ctx, {
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
    return true
  })
  if (!deleted) return { ok: false }
  revalidateFlowSubject(subject)
  return { ok: true }
}
