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
import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  isFormResponseParentLockedError,
  lockFormResponseForMutation,
  type Database,
} from '@beaconhs/db'
import { domainEventActor, recordDomainEvent } from '@beaconhs/events'
import {
  attachments,
  formResponseSteps,
  formResponses,
  formTemplateVersions,
  people,
  type FormResponseWorkflowState,
  type FormResponseWorkflowStepState,
  type FormSchemaV1,
  type FormWorkflowStep,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import { canAccessResponseTemplate } from '@/app/(app)/apps/_lib/access'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { isUuid } from '@/lib/list-params'
import { materializeFormResponseEvidenceChange } from '@/lib/forms/form-response-evidence'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString()
}

function revalidateResponse(id: string) {
  revalidatePath(`/apps/responses/${id}`)
  revalidatePath(`/apps/responses`)
}

class WorkflowMutationError extends Error {
  override readonly name = 'WorkflowMutationError'
}

async function recordStatusChangeFlow(
  tx: Database,
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  response: typeof formResponses.$inferSelect,
  toStatus: string,
): Promise<void> {
  await recordDomainEvent(tx, {
    tenantId: ctx.tenantId,
    eventType: 'form.status_changed',
    subjectId: response.id,
    dedupKey: `form.status_changed:${response.id}:${toStatus}:${randomUUID()}`,
    payload: {
      web: {
        kind: 'form_status_changed',
        subjectId: response.id,
        templateId: response.templateId,
        data: (response.data ?? {}) as Record<string, unknown>,
        score: response.complianceScore != null ? Number(response.complianceScore) : null,
        status: response.complianceStatus ?? null,
        toStatus,
        actor: domainEventActor(ctx),
      },
    },
  })
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
  if (!(await canAccessResponseTemplate(ctx, responseId, 'operate'))) {
    throw new Error('Form response not found')
  }
  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        response: formResponses,
        schema: formTemplateVersions.schema,
      })
      .from(formResponses)
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .where(and(eq(formResponses.id, responseId), isNull(formResponses.deletedAt)))
      .limit(1)
    return rows[0] ?? null
  })
  if (!result) throw new Error('Form response not found')
  // Per-user record visibility re-check: these workflow actions have no
  // dedicated permission, but a caller must at least be able to SEE the source
  // response (read.all → any; read.site → my sites; else → mine) before
  // signing / advancing / rejecting it by id. Same shape as the detail page.
  const visible = await ctx.db((tx) =>
    canSeeRecord(ctx, tx, {
      prefix: 'forms.response',
      ownerIds: [result.response.submittedBy],
      personId: result.response.subjectPersonId,
      siteId: result.response.siteOrgUnitId,
    }),
  )
  if (!visible) throw new Error('Form response not found')
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

type TenantTransaction = Parameters<
  Parameters<Awaited<ReturnType<typeof requireRequestContext>>['db']>[0]
>[0]

type StepRowMutation = {
  before: typeof formResponseSteps.$inferSelect | null
  after: typeof formResponseSteps.$inferSelect
}

// The caller must already hold the response lock returned by
// lockFormResponseForMutation in this same transaction. Keeping the child-row
// write behind that lock makes the step, response pointer/status, and
// denormalized workflow state one atomic lifecycle transition.
async function upsertStepRowAfterResponseLock(
  tx: TenantTransaction,
  tenantId: string,
  args: {
    responseId: string
    stepKey: string
    sequence: number
    patch: Partial<typeof formResponseSteps.$inferInsert>
  },
): Promise<StepRowMutation> {
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
    if (!updated) throw new Error('Failed to update step row')
    return { before: existing, after: updated }
  }
  const [inserted] = await tx
    .insert(formResponseSteps)
    .values({
      tenantId,
      responseId: args.responseId,
      stepKey: args.stepKey,
      sequence: args.sequence,
      ...args.patch,
    })
    .returning()
  if (!inserted) throw new Error('Failed to insert step row')
  return { before: null, after: inserted }
}

// Compose the denormalised `workflow_state` jsonb from all existing
// form_response_steps rows. Re-built on every state change.
async function rebuildWorkflowStateAfterResponseLock(
  tx: TenantTransaction,
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  args: {
    responseId: string
    workflowSteps: FormWorkflowStep[]
    lastAction: FormResponseWorkflowState['lastAction']
    lastReason?: string | null
  },
): Promise<FormResponseWorkflowState> {
  const rows = await tx
    .select()
    .from(formResponseSteps)
    .where(eq(formResponseSteps.responseId, args.responseId))
    .orderBy(asc(formResponseSteps.sequence))
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
      signatureAttachmentId: row.signatureAttachmentId ?? null,
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
  const [updated] = await tx
    .update(formResponses)
    .set({ workflowState: state })
    .where(eq(formResponses.id, args.responseId))
    .returning({ id: formResponses.id })
  if (!updated) throw new Error('Form response not found')
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

function canActOnWorkflowStep(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  response: typeof formResponses.$inferSelect,
  step: FormWorkflowStep,
  roleKeys: ReadonlySet<string>,
): boolean {
  if (ctx.isSuperAdmin || ctx.permissions.has('*')) return true
  const assignee = step.assignee
  if (assignee.type === 'literal') return assignee.userId === ctx.userId
  if (assignee.type === 'role') return !!assignee.role && roleKeys.has(assignee.role)
  if (assignee.type === 'expression' && assignee.expr.trim() === '$submitter') {
    return response.submittedBy === (ctx.membership?.id ?? null)
  }
  return false
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
  // ~5-15 KB; cap at 1 MB to avoid DoS via base64 bloat. Validate the INCOMING
  // base64 payload before we upload anything.
  if (args.signatureDataUrl.length > 1_500_000) {
    return { ok: false, error: 'Signature payload too large' }
  }

  const { response, workflowSteps, stepsByKey } = await loadResponseWithWorkflow(ctx, responseId)
  const meta = stepsByKey.get(stepKey)
  if (!meta) return { ok: false, error: `Unknown step "${stepKey}"` }
  const roleKeys = await getEffectiveRoleKeys(ctx)
  if (!canActOnWorkflowStep(ctx, response, meta.step, roleKeys)) {
    return { ok: false, error: 'You are not assigned to this workflow step' }
  }

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
        and(eq(formResponseSteps.responseId, responseId), eq(formResponseSteps.stepKey, stepKey)),
      )
      .limit(1)
    return r ?? null
  })
  if (existingRow?.status === 'signed') {
    return { ok: false, error: 'Step already signed' }
  }

  const personId = args.personId
  if (personId) {
    if (!isUuid(personId)) return { ok: false, error: 'Signer not found' }
    const [person] = await ctx.db((tx) =>
      tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(eq(people.id, personId), eq(people.tenantId, ctx.tenantId), isNull(people.deletedAt)),
        )
        .limit(1),
    )
    if (!person) return { ok: false, error: 'Signer not found' }
  }

  // Store only after every authorization/state check. The previous ordering
  // let an unauthorized or already-signed request create an orphaned object
  // before the action rejected it.
  try {
    await withStoredSignatureAttachment(ctx, args.signatureDataUrl, async (tx, attachmentId) => {
      if (!attachmentId) throw new Error('Signature could not be stored')
      const locked = await lockFormResponseForMutation(tx, ctx.tenantId!, responseId)
      if (!locked) throw new WorkflowMutationError('Form response not found')
      if (locked.locked) {
        throw new WorkflowMutationError('This response is locked and cannot be changed')
      }
      if (!canActOnWorkflowStep(ctx, locked, meta.step, roleKeys)) {
        throw new WorkflowMutationError('You are not assigned to this workflow step')
      }
      const lockedCurrentKey = resolveCurrentStepKey(locked, workflowSteps)
      if (lockedCurrentKey !== stepKey) {
        throw new WorkflowMutationError(`Step "${stepKey}" is no longer the active step`)
      }
      const [lockedStep] = await tx
        .select()
        .from(formResponseSteps)
        .where(
          and(eq(formResponseSteps.responseId, responseId), eq(formResponseSteps.stepKey, stepKey)),
        )
        .limit(1)
      if (lockedStep?.status === 'signed') throw new WorkflowMutationError('Step already signed')

      const stepMutation = await upsertStepRowAfterResponseLock(tx, ctx.tenantId!, {
        responseId,
        stepKey,
        sequence: meta.sequence,
        patch: {
          status: 'signed',
          signedAt: new Date(),
          signatureAttachmentId: attachmentId,
          signedByPersonId: args.personId ?? null,
          signedByTenantUserId: ctx.membership?.id ?? null,
          comment: args.comment ?? null,
          rejectionReason: null,
          rejectedAt: null,
          rejectedByTenantUserId: null,
        },
      })
      const previousSignatureAttachmentId = stepMutation.before?.signatureAttachmentId ?? null
      if (previousSignatureAttachmentId && previousSignatureAttachmentId !== attachmentId) {
        const [retired] = await tx
          .delete(attachments)
          .where(
            and(
              eq(attachments.tenantId, ctx.tenantId!),
              eq(attachments.id, previousSignatureAttachmentId),
              eq(attachments.kind, 'signature'),
            ),
          )
          .returning({ id: attachments.id })
        if (!retired) throw new Error('The previous workflow signature could not be retired')
      }

      // Keep currentStep pointing at the just-signed step. Caller is expected
      // to invoke advanceWorkflowStep() to move forward. The step row, pointer,
      // and denormalized state still commit atomically within this action.
      const [updated] = await tx
        .update(formResponses)
        .set({ currentStep: stepKey })
        .where(and(eq(formResponses.id, responseId), eq(formResponses.locked, false)))
        .returning({ id: formResponses.id })
      if (!updated) {
        throw new WorkflowMutationError('Form response changed before it could be signed')
      }
      await rebuildWorkflowStateAfterResponseLock(tx, ctx, {
        responseId,
        workflowSteps,
        lastAction: 'sign',
      })
    })
  } catch (error) {
    if (error instanceof WorkflowMutationError || isFormResponseParentLockedError(error)) {
      return { ok: false, error: error.message }
    }
    throw error
  }

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
}): Promise<
  { ok: true; nextStepKey: string | null; closed: boolean } | { ok: false; error: string }
> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const { responseId, currentStepKey } = args
  if (!responseId || !currentStepKey)
    return { ok: false, error: 'Missing responseId or currentStepKey' }

  const { response, workflowSteps, stepsByKey } = await loadResponseWithWorkflow(ctx, responseId)
  const meta = stepsByKey.get(currentStepKey)
  if (!meta) return { ok: false, error: `Unknown step "${currentStepKey}"` }
  const roleKeys = await getEffectiveRoleKeys(ctx)
  if (!canActOnWorkflowStep(ctx, response, meta.step, roleKeys)) {
    return { ok: false, error: 'You are not assigned to this workflow step' }
  }

  // Guard: must match the response's current pointer (or first step if null).
  const realCurrent = resolveCurrentStepKey(response, workflowSteps)
  if (realCurrent !== currentStepKey) {
    return {
      ok: false,
      error: `Cannot advance "${currentStepKey}"; response currently at "${realCurrent}"`,
    }
  }

  let transition:
    { ok: true; nextStepKey: string | null; closed: boolean } | { ok: false; error: string }
  try {
    transition = await ctx.db(async (tx) => {
      const before = await lockFormResponseForMutation(tx, ctx.tenantId!, responseId)
      if (!before) return { ok: false as const, error: 'Form response not found' }
      if (before.locked) {
        return { ok: false as const, error: 'This response is locked and cannot be changed' }
      }
      if (!canActOnWorkflowStep(ctx, before, meta.step, roleKeys)) {
        return { ok: false as const, error: 'You are not assigned to this workflow step' }
      }
      const lockedCurrent = resolveCurrentStepKey(before, workflowSteps)
      if (lockedCurrent !== currentStepKey) {
        return {
          ok: false as const,
          error: `Cannot advance "${currentStepKey}"; response currently at "${lockedCurrent}"`,
        }
      }

      if (meta.step.signatureRequired) {
        const [stepRow] = await tx
          .select()
          .from(formResponseSteps)
          .where(
            and(
              eq(formResponseSteps.responseId, responseId),
              eq(formResponseSteps.stepKey, currentStepKey),
            ),
          )
          .limit(1)
        if (!stepRow || stepRow.status !== 'signed') {
          return {
            ok: false as const,
            error: 'This step requires a signature before it can be advanced',
          }
        }
      } else {
        // Non-signature steps still receive a durable completion row. The
        // current schema calls that terminal step state "signed".
        await upsertStepRowAfterResponseLock(tx, ctx.tenantId!, {
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

      const next = workflowSteps[meta.sequence + 1] ?? null
      const toStatus = next ? 'in_progress' : 'closed'
      const [updated] = await tx
        .update(formResponses)
        .set(
          next
            ? { currentStep: next.key, status: 'in_progress' }
            : { status: 'closed', closedAt: new Date(), currentStep: currentStepKey },
        )
        .where(and(eq(formResponses.id, responseId), eq(formResponses.locked, false)))
        .returning()
      if (!updated) {
        throw new WorkflowMutationError('Form response changed before it could advance')
      }
      await materializeFormResponseEvidenceChange(tx, ctx.tenantId!, before, updated)
      await recordStatusChangeFlow(tx, ctx, before, toStatus)
      await rebuildWorkflowStateAfterResponseLock(tx, ctx, {
        responseId,
        workflowSteps,
        lastAction: 'advance',
      })
      return { ok: true as const, nextStepKey: next?.key ?? null, closed: !next }
    })
  } catch (error) {
    if (error instanceof WorkflowMutationError || isFormResponseParentLockedError(error)) {
      return { ok: false, error: error.message }
    }
    throw error
  }
  if (!transition.ok) return transition

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: transition.closed
      ? `Advanced workflow: closed after "${currentStepKey}"`
      : `Advanced workflow: "${currentStepKey}" → "${transition.nextStepKey}"`,
    metadata: {
      from: currentStepKey,
      to: transition.nextStepKey,
      closed: transition.closed,
    },
  })
  revalidateResponse(responseId)
  return transition
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
  if (!responseId || !currentStepKey)
    return { ok: false, error: 'Missing responseId or currentStepKey' }
  const trimmed = (reason ?? '').trim()
  if (trimmed.length === 0) return { ok: false, error: 'A rejection reason is required' }
  if (trimmed.length > 4000) return { ok: false, error: 'Reason is too long (max 4000 chars)' }

  const { response, workflowSteps, stepsByKey } = await loadResponseWithWorkflow(ctx, responseId)
  const meta = stepsByKey.get(currentStepKey)
  if (!meta) return { ok: false, error: `Unknown step "${currentStepKey}"` }
  const roleKeys = await getEffectiveRoleKeys(ctx)
  if (!canActOnWorkflowStep(ctx, response, meta.step, roleKeys)) {
    return { ok: false, error: 'You are not assigned to this workflow step' }
  }

  const realCurrent = resolveCurrentStepKey(response, workflowSteps)
  if (realCurrent !== currentStepKey) {
    return {
      ok: false,
      error: `Cannot reject "${currentStepKey}"; response currently at "${realCurrent}"`,
    }
  }

  let mutation: { ok: true; newStatus: 'in_review' | 'in_progress' } | { ok: false; error: string }
  try {
    mutation = await ctx.db(async (tx) => {
      const before = await lockFormResponseForMutation(tx, ctx.tenantId!, responseId)
      if (!before) return { ok: false as const, error: 'Form response not found' }
      if (before.locked) {
        return { ok: false as const, error: 'This response is locked and cannot be changed' }
      }
      if (!canActOnWorkflowStep(ctx, before, meta.step, roleKeys)) {
        return { ok: false as const, error: 'You are not assigned to this workflow step' }
      }
      const lockedCurrent = resolveCurrentStepKey(before, workflowSteps)
      if (lockedCurrent !== currentStepKey) {
        return {
          ok: false as const,
          error: `Cannot reject "${currentStepKey}"; response currently at "${lockedCurrent}"`,
        }
      }

      const stepMutation = await upsertStepRowAfterResponseLock(tx, ctx.tenantId!, {
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
          signatureAttachmentId: null,
          signedByPersonId: null,
          signedByTenantUserId: null,
        },
      })
      const previousSignatureAttachmentId = stepMutation.before?.signatureAttachmentId ?? null
      if (previousSignatureAttachmentId) {
        const [retired] = await tx
          .delete(attachments)
          .where(
            and(
              eq(attachments.tenantId, ctx.tenantId!),
              eq(attachments.id, previousSignatureAttachmentId),
              eq(attachments.kind, 'signature'),
            ),
          )
          .returning({ id: attachments.id })
        if (!retired) throw new Error('The rejected workflow signature could not be retired')
      }

      // Submitted/closed evidence stays evaluator-eligible in review. Earlier
      // draft workflow states return to in-progress and remain ineligible.
      const newStatus =
        before.status === 'submitted' || before.status === 'closed'
          ? ('in_review' as const)
          : ('in_progress' as const)
      const [updated] = await tx
        .update(formResponses)
        .set({
          status: newStatus,
          currentStep: currentStepKey,
          closedAt: null,
        })
        .where(and(eq(formResponses.id, responseId), eq(formResponses.locked, false)))
        .returning()
      if (!updated) {
        throw new WorkflowMutationError('Form response changed before it could be rejected')
      }
      await materializeFormResponseEvidenceChange(tx, ctx.tenantId!, before, updated)
      await recordStatusChangeFlow(tx, ctx, before, newStatus)
      await rebuildWorkflowStateAfterResponseLock(tx, ctx, {
        responseId,
        workflowSteps,
        lastAction: 'reject',
        lastReason: trimmed,
      })
      return { ok: true as const, newStatus }
    })
  } catch (error) {
    if (error instanceof WorkflowMutationError || isFormResponseParentLockedError(error)) {
      return { ok: false, error: error.message }
    }
    throw error
  }
  if (!mutation.ok) return mutation

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: `Rejected workflow step "${currentStepKey}"`,
    metadata: { stepKey: currentStepKey, reason: trimmed, newStatus: mutation.newStatus },
  })

  revalidateResponse(responseId)
  return { ok: true }
}
