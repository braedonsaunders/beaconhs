'use server'

// Generic flow CRUD for ANY subject (form templates + native modules). The same
// FlowsCanvas calls these; authorization branches on the subject — forms gate on
// forms.template.create, modules on their Manage permission.

import { eq } from 'drizzle-orm'
import { automationGraphSchema, emptyAutomationGraph } from '@beaconhs/forms-core'
import { can, type RequestContext } from '@beaconhs/tenant'
import { formAutomations } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'

export type FlowSubjectRef = { type: 'form_template' | 'module'; key: string }

function authorizeSubject(ctx: RequestContext, subject: FlowSubjectRef): boolean {
  if (ctx.isSuperAdmin) return true
  if (subject.type === 'form_template') return can(ctx, 'forms.template.create')
  if (subject.type === 'module') return canManageModule(ctx, subject.key)
  return false
}

async function loadSubject(ctx: RequestContext, flowId: string): Promise<FlowSubjectRef | null> {
  const [f] = await ctx.db((tx) =>
    tx
      .select({
        subjectType: formAutomations.subjectType,
        subjectKey: formAutomations.subjectKey,
        templateId: formAutomations.templateId,
      })
      .from(formAutomations)
      .where(eq(formAutomations.id, flowId))
      .limit(1),
  )
  if (!f) return null
  return { type: f.subjectType, key: f.subjectKey ?? f.templateId ?? '' }
}

export async function createFlow(
  subject: FlowSubjectRef,
  name?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  if (!authorizeSubject(ctx, subject)) return { ok: false, error: 'Not authorized' }

  const [row] = await ctx.db((tx) =>
    tx
      .insert(formAutomations)
      .values({
        tenantId: ctx.tenantId,
        subjectType: subject.type,
        subjectKey: subject.key,
        templateId: subject.type === 'form_template' ? subject.key : null,
        name: name?.trim() || 'Flow',
        enabled: true,
        graph: emptyAutomationGraph(),
      })
      .returning({ id: formAutomations.id }),
  )
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

  const parsed = automationGraphSchema.safeParse(graph)
  if (!parsed.success) return { ok: false, error: 'Invalid flow graph' }
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ graph: parsed.data, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  return { ok: true }
}

export async function renameFlow(flowId: string, name: string): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject || !authorizeSubject(ctx, subject)) return { ok: false }
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ name: name.trim() || 'Flow', updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  return { ok: true }
}

export async function setFlowEnabled(flowId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject || !authorizeSubject(ctx, subject)) return { ok: false }
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  return { ok: true }
}

export async function deleteFlow(flowId: string): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  const subject = await loadSubject(ctx, flowId)
  if (!subject || !authorizeSubject(ctx, subject)) return { ok: false }
  await ctx.db((tx) => tx.delete(formAutomations).where(eq(formAutomations.id, flowId)))
  return { ok: true }
}
