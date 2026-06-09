'use server'

// CRUD for an App's Flows. Each template can have MANY named flows, each
// independently enable/disable-able. All gated by forms.template.create.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { formAutomations } from '@beaconhs/db/schema'
import { automationGraphSchema, emptyAutomationGraph } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

async function gate() {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')
  return ctx
}

export async function createFlow(
  templateId: string,
  name?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ctx = await gate()
  if (!templateId) return { ok: false, error: 'Missing template' }
  const flowName = name?.trim() || 'New flow'
  const id = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(formAutomations)
      .values({
        tenantId: ctx.tenantId,
        templateId,
        name: flowName,
        enabled: true,
        graph: emptyAutomationGraph(),
      })
      .returning({ id: formAutomations.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: templateId,
    action: 'update',
    summary: `Created flow "${flowName}"`,
  })
  revalidatePath(`/forms/templates/${templateId}/flows`)
  return { ok: true, id }
}

export async function saveFlow(
  flowId: string,
  graph: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await gate()
  const parsed = automationGraphSchema.safeParse(graph)
  if (!parsed.success) return { ok: false, error: 'Invalid flow — check the nodes and try again.' }
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ graph: parsed.data, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  return { ok: true }
}

export async function renameFlow(flowId: string, name: string): Promise<{ ok: boolean }> {
  const ctx = await gate()
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ name: name.trim() || 'Flow', updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  return { ok: true }
}

export async function setFlowEnabled(flowId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const ctx = await gate()
  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  return { ok: true }
}

export async function deleteFlow(flowId: string): Promise<{ ok: boolean }> {
  const ctx = await gate()
  await ctx.db((tx) => tx.delete(formAutomations).where(eq(formAutomations.id, flowId)))
  return { ok: true }
}
