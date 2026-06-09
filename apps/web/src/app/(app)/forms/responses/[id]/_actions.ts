'use server'

// Server actions backing the workflow-step UI on the form-response detail page.
// These are the **only** writers to form_response_steps + form_responses.workflow_state
// for the sign / advance / reject lifecycle.
//
// Why a dedicated file (not the global forms actions): each call must
//   1. Verify the step is the current step (state-machine guard).
//   2. Write the per-step row AND the denormalised workflow_state jsonb so a
//      single read of form_responses can render the panel.
//   3. Update response.status when a workflow boundary is crossed
//      (closed on final sign, in_review on reject).
//   4. recordAudit with action='sign' | 'update'.
//
// The legacy `formResponses.currentStep` text column carries the *pointer* to
// the active step's key; sequence is read from the template's workflow.steps.
// Until a response has touched the workflow at all, currentStep is null and
// the panel renders only "Start workflow" using the first step from the
// template schema.

import { revalidatePath } from 'next/cache'
import { and, asc, eq } from 'drizzle-orm'
import {
  formResponseSteps,
  formResponses,
  formTemplateVersions,
  type FormResponseWorkflowState,
  type FormResponseWorkflowStepState,
  type FormSchemaV1,
  type FormWorkflowStep,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { runStatusChangeAutomations } from '@/app/(app)/forms/_lib/run-automations'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString()
}

function revalidateResponse(id: string) {
  revalidatePath(`/forms/responses/${id}`)
  revalidatePath(`/forms/responses`)
}

// Fire status_change flows for a response transition. Best-effort: a flow must
// never break the workflow action, so failures are swallowed.
async function fireStatusChange(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  response: typeof formResponses.$inferSelect,
  toStatus: string,
): Promise<void> {
  try {
    await runStatusChangeAutomations(ctx, {
      templateId: response.templateId,
      responseId: response.id,
      data: (response.data ?? {}) as Record<string, unknown>,
      score: response.complianceScore != null ? Number(response.complianceScore) : null,
      status: response.complianceStatus ?? null,
      toStatus,
    })
  } catch {
    // ignore — flows are best-effort
  }
}

// Resolve a response + its template's workflow schema in one round-trip.
// Throws if the response is missing or has no workflow defined.
async function loadResponseWithWorkflow(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  responseId: string,
): Promise<{
  response: typeof formResponses.$inferSelect
  schema: FormSchemaV1
  workflowSteps: FormWorkflowStep[]
  stepsByKey: Map<string, { step: FormWorkflowStep; sequence: number }>
}> {
  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        response: formResponses,
        schema: formTemplateVersions.schema,
      })
      .from(formResponses)
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .where(eq(formResponses.id, responseId))
      .limit(1)
    return rows[0] ?? null
  })
  if (!result) throw new Error('Form response not found')
  const schema = result.schema as FormSchemaV1
  const workflowSteps = schema.workflow?.steps ?? []
  if (workflowSteps.length === 0) {
    throw new Error('This form has no workflow configured')
  }
  const stepsByKey = new Map<string, { step: FormWorkflowStep; sequence: number }>()
  workflowSteps.forEach((s, i) => stepsByKey.set(s.key, { step: s, sequence: i }))
  return {
    response: result.response,
    schema,
    workflowSteps,
    stepsByKey,
  }
}

// Materialise an upsert-style write to form_response_steps. Drizzle doesn't
// expose ON CONFLICT cleanly across versions for partial-update tracking, so
// we do a select-then-(update|insert).
async function upsertStepRow(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  args: {
    responseId: string
    stepKey: string
    sequence: number
    patch: Partial<typeof formResponseSteps.$inferInsert>
  },
): Promise<typeof formResponseSteps.$inferSelect> {
  return await ctx.db(async (tx) => {
    const [existing] = await tx
      .select()
      .from(formResponseSteps)
      .where(
        and(
          eq(formResponseSteps.responseId, args.responseId),
          eq(formResponseSteps.stepKey, args.stepKey),
        ),
      )
      .limit(1)
    if (existing) {
      const [updated] = await tx
        .update(formResponseSteps)
        .set(args.patch)
        .where(eq(formResponseSteps.id, existing.id))
        .returning()
      return updated ?? existing
    }
    const [inserted] = await tx
      .insert(formResponseSteps)
      .values({
        tenantId: ctx.tenantId!,
        responseId: args.responseId,
        stepKey: args.stepKey,
        sequence: args.sequence,
        ...args.patch,
      })
      .returning()
    if (!inserted) throw new Error('Failed to insert step row')
    return inserted
  })
}

// Compose the denormalised `workflow_state` jsonb from all existing
// form_response_steps rows. Re-built on every state change.
async function rebuildWorkflowState(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  args: {
    responseId: string
    workflowSteps: FormWorkflowStep[]
    lastAction: FormResponseWorkflowState['lastAction']
    lastReason?: string | null
  },
): Promise<FormResponseWorkflowState> {
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(formResponseSteps)
      .where(eq(formResponseSteps.responseId, args.responseId))
      .orderBy(asc(formResponseSteps.sequence)),
  )
  const byKey = new Map(rows.map((r) => [r.stepKey, r]))
  const steps: FormResponseWorkflowStepState[] = args.workflowSteps.map((wf, i) => {
    const row = byKey.get(wf.key)
    if (!row) {
      return {
        stepKey: wf.key,
        sequence: i,
        status: 'pending',
      }
    }
    return {
      stepKey: row.stepKey,
      sequence: row.sequence,
      status: (row.status ?? 'pending') as FormResponseWorkflowStepState['status'],
      signedAt: row.signedAt ? row.signedAt.toISOString() : undefined,
      personId: row.signedByPersonId ?? null,
      tenantUserId: row.signedByTenantUserId ?? null,
      signatureDataUrl: row.signatureDataUrl ?? null,
      rejectionReason: row.rejectionReason ?? null,
      rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : undefined,
      rejectedByTenantUserId: row.rejectedByTenantUserId ?? null,
      comment: row.comment ?? null,
    }
  })
  const state: FormResponseWorkflowState = {
    steps,
    lastActionAt: nowIso(),
    lastAction: args.lastAction,
    lastActionByTenantUserId: ctx.membership?.id ?? null,
    lastReason: args.lastReason ?? null,
  }
  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({ workflowState: state })
      .where(eq(formResponses.id, args.responseId)),
  )
  return state
}

// Defensive: a workflow can only act on the response's currentStep. If
// currentStep is null (untouched), the *first* step of the workflow is the
// current step. This lets the UI "start" a workflow without an explicit kick.
function resolveCurrentStepKey(
  response: typeof formResponses.$inferSelect,
  workflowSteps: FormWorkflowStep[],
): string {
  if (response.currentStep) return response.currentStep
  const first = workflowSteps[0]
  if (!first) throw new Error('Workflow has no steps')
  return first.key
}

// ---------------------------------------------------------------------------
// 1. signWorkflowStep — capture a signature + mark the step signed
// ---------------------------------------------------------------------------

export async function signWorkflowStep(args: {
  responseId: string
  stepKey: string
  signatureDataUrl: string
  comment?: string | null
  personId?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const { responseId, stepKey } = args
  if (!responseId || !stepKey) return { ok: false, error: 'Missing responseId or stepKey' }
  if (!args.signatureDataUrl?.startsWith('data:image/')) {
    return { ok: false, error: 'Signature must be a PNG data URL' }
  }
  // Sanity bound on signature size — a 140px-tall canvas PNG is typically
  // ~5-15 KB; cap at 1 MB to avoid DoS via base64 bloat.
  if (args.signatureDataUrl.length > 1_500_000) {
    return { ok: false, error: 'Signature payload too large' }
  }

  const { response, workflowSteps, stepsByKey } = await loadResponseWithWorkflow(ctx, responseId)
  const meta = stepsByKey.get(stepKey)
  if (!meta) return { ok: false, error: `Unknown step "${stepKey}"` }

  // State-machine guard: only the current step is signable. (currentStep may
  // be null on a freshly submitted response — then the first step is current.)
  const currentKey = resolveCurrentStepKey(response, workflowSteps)
  if (currentKey !== stepKey) {
    return {
      ok: false,
      error: `Step "${stepKey}" is not the active step (current: "${currentKey}")`,
    }
  }

  // Don't double-sign.
  const existingRow = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(formResponseSteps)
      .where(
        and(
          eq(formResponseSteps.responseId, responseId),
          eq(formResponseSteps.stepKey, stepKey),
        ),
      )
      .limit(1)
    return r ?? null
  })
  if (existingRow?.status === 'signed') {
    return { ok: false, error: 'Step already signed' }
  }

  await upsertStepRow(ctx, {
    responseId,
    stepKey,
    sequence: meta.sequence,
    patch: {
      status: 'signed',
      signedAt: new Date(),
      signatureDataUrl: args.signatureDataUrl,
      signedByPersonId: args.personId ?? null,
      signedByTenantUserId: ctx.membership?.id ?? null,
      comment: args.comment ?? null,
      // Clear rejection state if this is a re-attempt after a previous reject.
      rejectionReason: null,
      rejectedAt: null,
      rejectedByTenantUserId: null,
    },
  })

  // Keep currentStep pointing at the just-signed step. Caller is expected to
  // chain advanceWorkflowStep() to move forward. (Separating sign + advance
  // lets a multi-signer step model be added later without breaking the API.)
  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({ currentStep: stepKey })
      .where(eq(formResponses.id, responseId)),
  )

  await rebuildWorkflowState(ctx, {
    responseId,
    workflowSteps,
    lastAction: 'sign',
  })

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'sign',
    summary: `Signed workflow step "${stepKey}"`,
    metadata: { stepKey, hasComment: !!args.comment },
  })

  revalidateResponse(responseId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 2. advanceWorkflowStep — mark current step complete + move pointer
// ---------------------------------------------------------------------------

export async function advanceWorkflowStep(args: {
  responseId: string
  currentStepKey: string
}): Promise<{ ok: true; nextStepKey: string | null; closed: boolean } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const { responseId, currentStepKey } = args
  if (!responseId || !currentStepKey) return { ok: false, error: 'Missing responseId or currentStepKey' }

  const { response, workflowSteps, stepsByKey } = await loadResponseWithWorkflow(ctx, responseId)
  const meta = stepsByKey.get(currentStepKey)
  if (!meta) return { ok: false, error: `Unknown step "${currentStepKey}"` }

  // Guard: must match the response's current pointer (or first step if null).
  const realCurrent = resolveCurrentStepKey(response, workflowSteps)
  if (realCurrent !== currentStepKey) {
    return {
      ok: false,
      error: `Cannot advance "${currentStepKey}"; response currently at "${realCurrent}"`,
    }
  }

  // Guard: if the step has signatureRequired, it must be signed before advancing.
  const stepConfig = meta.step
  if (stepConfig.signatureRequired) {
    const [stepRow] = await ctx.db((tx) =>
      tx
        .select()
        .from(formResponseSteps)
        .where(
          and(
            eq(formResponseSteps.responseId, responseId),
            eq(formResponseSteps.stepKey, currentStepKey),
          ),
        )
        .limit(1),
    )
    if (!stepRow || stepRow.status !== 'signed') {
      return {
        ok: false,
        error: 'This step requires a signature before it can be advanced',
      }
    }
  } else {
    // Non-signature step: mark as signed-equivalent so the audit trail is
    // complete. Status 'signed' here means "completed". A future revision could
    // split into a 'completed' status; for now signed covers both.
    await upsertStepRow(ctx, {
      responseId,
      stepKey: currentStepKey,
      sequence: meta.sequence,
      patch: {
        status: 'signed',
        signedAt: new Date(),
        signedByTenantUserId: ctx.membership?.id ?? null,
      },
    })
  }

  // Find the next step in sequence.
  const idx = meta.sequence
  const next = workflowSteps[idx + 1] ?? null

  if (next) {
    await ctx.db((tx) =>
      tx
        .update(formResponses)
        .set({
          currentStep: next.key,
          status: 'in_progress',
        })
        .where(eq(formResponses.id, responseId)),
    )
    await rebuildWorkflowState(ctx, {
      responseId,
      workflowSteps,
      lastAction: 'advance',
    })
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: responseId,
      action: 'update',
      summary: `Advanced workflow: "${currentStepKey}" → "${next.key}"`,
      metadata: { from: currentStepKey, to: next.key },
    })
    await fireStatusChange(ctx, response, 'in_progress')
    revalidateResponse(responseId)
    return { ok: true, nextStepKey: next.key, closed: false }
  }

  // No more steps — close the response.
  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({
        status: 'closed',
        closedAt: new Date(),
        currentStep: currentStepKey,
      })
      .where(eq(formResponses.id, responseId)),
  )
  await rebuildWorkflowState(ctx, {
    responseId,
    workflowSteps,
    lastAction: 'advance',
  })
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: `Advanced workflow: closed after "${currentStepKey}"`,
    metadata: { from: currentStepKey, closed: true },
  })
  await fireStatusChange(ctx, response, 'closed')
  revalidateResponse(responseId)
  return { ok: true, nextStepKey: null, closed: true }
}

// ---------------------------------------------------------------------------
// 3. rejectWorkflowStep — bounce the step back with a reason
// ---------------------------------------------------------------------------

export async function rejectWorkflowStep(args: {
  responseId: string
  currentStepKey: string
  reason: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const { responseId, currentStepKey, reason } = args
  if (!responseId || !currentStepKey) return { ok: false, error: 'Missing responseId or currentStepKey' }
  const trimmed = (reason ?? '').trim()
  if (trimmed.length === 0) return { ok: false, error: 'A rejection reason is required' }
  if (trimmed.length > 4000) return { ok: false, error: 'Reason is too long (max 4000 chars)' }

  const { response, workflowSteps, stepsByKey } = await loadResponseWithWorkflow(ctx, responseId)
  const meta = stepsByKey.get(currentStepKey)
  if (!meta) return { ok: false, error: `Unknown step "${currentStepKey}"` }

  const realCurrent = resolveCurrentStepKey(response, workflowSteps)
  if (realCurrent !== currentStepKey) {
    return {
      ok: false,
      error: `Cannot reject "${currentStepKey}"; response currently at "${realCurrent}"`,
    }
  }

  await upsertStepRow(ctx, {
    responseId,
    stepKey: currentStepKey,
    sequence: meta.sequence,
    patch: {
      status: 'rejected',
      rejectionReason: trimmed,
      rejectedAt: new Date(),
      rejectedByTenantUserId: ctx.membership?.id ?? null,
      // Clear any prior signature so re-sign starts clean.
      signedAt: null,
      signatureDataUrl: null,
      signedByPersonId: null,
      signedByTenantUserId: null,
    },
  })

  // Move the response into review state. We pick 'in_review' if the response
  // was 'submitted' or further, otherwise 'in_progress' so a worker can
  // re-engage. The legacy enum already supports both. We leave currentStep
  // pointing at the rejected step so re-sign can re-engage in-place.
  const newStatus =
    response.status === 'submitted' || response.status === 'closed' ? 'in_review' : 'in_progress'

  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({
        status: newStatus,
        currentStep: currentStepKey,
        closedAt: null,
      })
      .where(eq(formResponses.id, responseId)),
  )

  await rebuildWorkflowState(ctx, {
    responseId,
    workflowSteps,
    lastAction: 'reject',
    lastReason: trimmed,
  })

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: `Rejected workflow step "${currentStepKey}"`,
    metadata: { stepKey: currentStepKey, reason: trimmed, newStatus },
  })

  await fireStatusChange(ctx, response, newStatus)
  revalidateResponse(responseId)
  return { ok: true }
}
