'use server'

// Run a CONFIGURABLE record-action button. Each button is a `manual`-trigger
// Flow stored in form_automations (authored in the designer's Actions tab /
// flows canvas). Clicking it plans that flow from its manual trigger and runs it
// through the SAME subject-agnostic executor used by on-submit/status flows — so
// a button can be a single action (Create CAPA) or a whole graph with
// conditions + approval gates. No second automation system.

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { evaluateLogicRule, planAutomation, type AutomationPlan } from '@beaconhs/forms-core'
import { formAutomations, formResponses, people } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan } from '@/app/(app)/apps/_lib/run-automations'
import { createFormFlowAdapter } from '@/app/(app)/apps/_lib/form-flow-adapter'
import { canAccessResponseTemplate } from '@/app/(app)/apps/_lib/access'
import { isUuid } from '@/lib/list-params'

export async function runRecordAction(input: {
  responseId: string
  flowId: string
  buttonId: string
  // Optional values collected from the button's input drawer, merged over the
  // record's field-map before planning (so {{token}}s can reference them).
  inputs?: Record<string, unknown>
}): Promise<{ ok: boolean; ran?: string[]; failed?: string[]; error?: string }> {
  const ctx = await requireRequestContext()
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      !isUuid(input.responseId) ||
      !isUuid(input.flowId) ||
      typeof input.buttonId !== 'string' ||
      input.buttonId.length === 0 ||
      input.buttonId.length > 128 ||
      (input.inputs !== undefined &&
        (!input.inputs || typeof input.inputs !== 'object' || Array.isArray(input.inputs)))
    ) {
      return { ok: false, error: 'Action not found' }
    }
    if (!(await canAccessResponseTemplate(ctx, input.responseId, 'operate'))) {
      return { ok: false, error: 'Action not found' }
    }
    const [flow] = await ctx.db((tx) =>
      tx
        .select({
          id: formAutomations.id,
          templateId: formAutomations.templateId,
          graph: formAutomations.graph,
          enabled: formAutomations.enabled,
        })
        .from(formAutomations)
        .where(
          and(eq(formAutomations.id, input.flowId), eq(formAutomations.tenantId, ctx.tenantId)),
        )
        .limit(1),
    )
    if (!flow) return { ok: false, error: 'Action not found' }
    if (!flow.enabled) return { ok: false, error: 'This action is disabled' }

    // Load the target response and re-check server-side that (a) it actually
    // belongs to the flow's template (a flow must never run against another
    // app's records) and (b) the caller can SEE it under the per-user record
    // visibility tiers — this action is network-callable with arbitrary ids.
    const target = await ctx.db(async (tx) => {
      const [r] = await tx
        .select({
          templateId: formResponses.templateId,
          submittedBy: formResponses.submittedBy,
          subjectPersonId: formResponses.subjectPersonId,
          siteOrgUnitId: formResponses.siteOrgUnitId,
        })
        .from(formResponses)
        .where(and(eq(formResponses.id, input.responseId), isNull(formResponses.deletedAt)))
        .limit(1)
      return r ?? null
    })
    if (!target || target.templateId !== flow.templateId) {
      return { ok: false, error: 'Action not found' }
    }
    if (
      !(await ctx.db((tx) =>
        canSeeRecord(ctx, tx, {
          prefix: 'forms.response',
          ownerIds: [target.submittedBy],
          personId: target.subjectPersonId,
          siteId: target.siteOrgUnitId,
        }),
      ))
    ) {
      return { ok: false, error: 'Action not found' }
    }

    // Re-check the button's authored gates server-side (the action bar already
    // hides it, but never trust the client): the required permission AND the
    // showIf display condition, evaluated against the record's current values.
    const node = flow.graph.nodes.find(
      (n) =>
        n.data.kind === 'trigger' &&
        n.data.trigger.trigger === 'manual' &&
        n.data.trigger.buttonId === input.buttonId,
    )
    if (!node || node.data.kind !== 'trigger' || node.data.trigger.trigger !== 'manual') {
      return { ok: false, error: 'Action not found' }
    }
    const adapter = createFormFlowAdapter(ctx, input.responseId)
    const recordValues = await adapter.loadValues()
    const td = node.data.trigger
    if (td.requirePermission && !can(ctx, td.requirePermission)) {
      return { ok: false, error: 'You do not have permission to run this action' }
    }
    if (
      td.showIf &&
      !evaluateLogicRule(td.showIf, { values: recordValues, rows: {}, entities: {} })
    ) {
      return { ok: false, error: 'This action is not available for this record' }
    }

    const supplied = input.inputs ?? {}
    if (Object.keys(supplied).length > 50) return { ok: false, error: 'Too many action inputs' }
    const actionInputs: Record<string, unknown> = {}
    for (const spec of td.inputs ?? []) {
      const raw = supplied[spec.id]
      const missing = raw === undefined || raw === null || raw === ''
      if (missing) {
        if (spec.required) return { ok: false, error: `${spec.label} is required` }
        continue
      }
      if (spec.type === 'number') {
        const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
        if (!Number.isFinite(value)) return { ok: false, error: `${spec.label} must be a number` }
        actionInputs[spec.id] = value
      } else if (spec.type === 'person') {
        if (typeof raw !== 'string' || !isUuid(raw)) {
          return { ok: false, error: `${spec.label} is invalid` }
        }
        actionInputs[spec.id] = raw
      } else if (spec.type === 'date') {
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          return { ok: false, error: `${spec.label} must be a date` }
        }
        const date = new Date(`${raw}T00:00:00.000Z`)
        if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== raw) {
          return { ok: false, error: `${spec.label} must be a date` }
        }
        actionInputs[spec.id] = raw
      } else {
        if (typeof raw !== 'string') return { ok: false, error: `${spec.label} is invalid` }
        const value = raw.trim().slice(0, spec.type === 'textarea' ? 10_000 : 2_000)
        if (spec.required && !value) return { ok: false, error: `${spec.label} is required` }
        if (
          spec.type === 'select' &&
          spec.options &&
          !spec.options.some((option) => option.value === value)
        ) {
          return { ok: false, error: `${spec.label} is invalid` }
        }
        actionInputs[spec.id] = value
      }
    }
    const personIds = Array.from(
      new Set(
        (td.inputs ?? [])
          .filter((spec) => spec.type === 'person')
          .map((spec) => actionInputs[spec.id])
          .filter((value): value is string => typeof value === 'string'),
      ),
    )
    if (personIds.length > 0) {
      const available = await ctx.db((tx) =>
        tx
          .select({ id: people.id })
          .from(people)
          .where(and(inArray(people.id, personIds), isNull(people.deletedAt))),
      )
      if (available.length !== personIds.length) {
        return { ok: false, error: 'One or more selected people are unavailable' }
      }
    }

    const values: Record<string, unknown> = {
      ...recordValues,
      ...actionInputs,
    }

    let plan: AutomationPlan
    try {
      plan = planAutomation(
        flow.graph,
        'manual',
        { values, rows: {}, entities: {} },
        {
          buttonId: input.buttonId,
        },
      )
    } catch {
      return { ok: false, error: 'Could not plan this action' }
    }
    if (plan.actions.length === 0 && plan.gates.length === 0) {
      return { ok: false, error: 'This action has no steps configured' }
    }

    const res = await executeFlowPlan(ctx, {
      responseId: input.responseId,
      flowId: flow.id,
      plan,
      values,
    })

    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: input.responseId,
      action: 'update',
      summary: `Ran action: ${res.ran.length ? res.ran.join(', ') : 'no steps ran'}${
        res.failed.length ? ` · issues ${res.failed.join(', ')}` : ''
      }`,
    })
    revalidatePath(`/apps/responses/${input.responseId}`)
    return { ok: true, ran: res.ran, failed: res.failed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Action failed' }
  }
}
