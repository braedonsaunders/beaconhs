// Record-page field edits for Builder responses: the `apps` saver behind
// /api/records/sync (see lib/record-sync/registry.ts).
//
// Each field writes straight into the response's canonical `data` and
// recomputes compliance — the record is already a live entity being edited in
// place. Edits are queued on the device and may arrive late, so every patch
// is a compare-and-set: it applies only while the field still holds the
// patch's `base` value. A patch whose value is already stored is acknowledged
// without writing (safe retries). Any other field value is a conflict, and
// that field is left untouched for the worker to resolve.
//
// Gates:
//   - response exists in the active tenant (RLS via ctx.db), under the shared
//     parent-first row lock
//   - `locked` must be false
//   - caller owns the row (submittedBy = membership) OR has the reviewer/manage
//     tier / wildcard / super-admin; adopts ownership when submittedBy is null
//   - each fieldId must be a top-level field id OR a repeating-section id
//
// Unlike the native modules' savers this one validates the merged payload as
// a whole (schema validation and the compliance score span fields), so it is
// written directly against the RecordSaver contract instead of through
// `defineRecordSaver`.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { isFormResponseParentLockedError, lockFormResponseForMutation } from '@beaconhs/db'
import {
  formResponses,
  formTemplateVersions,
  type FormResponseDraftData,
} from '@beaconhs/db/schema'
import { normalizeFormResponseData, validateResponse } from '@beaconhs/forms-core'
import { recordAudit } from '@/lib/audit'
import { jsonEqual } from '@/lib/offline-drafts/model'
import type { RecordSyncSuccess, SyncFailure } from '@/lib/offline-drafts/protocol'
import type { RecordSaver } from '@/lib/record-sync/edits'
import { canEditResponsePayload } from '@/app/(app)/apps/_lib/access'
import { canFillResponse } from '@/app/(app)/apps/_lib/draft-persistence'
import { computeFormScore } from '@/app/(app)/apps/_lib/score-router'
import { responsePayload } from '@/app/(app)/apps/_lib/response-payload'

export const saveAppRecordEdits: RecordSaver = async (ctx, responseId, patches) => {
  const request = { responseId, patches }
  if (!(await canFillResponse(ctx, request.responseId))) {
    return { ok: false, error: 'You do not have access to this app', reason: 'forbidden' }
  }

  try {
    const result = await ctx.db(
      async (tx): Promise<(RecordSyncSuccess & { wrote: boolean }) | SyncFailure> => {
        const mutable = await lockFormResponseForMutation(tx, ctx.tenantId, request.responseId)
        if (!mutable) return { ok: false, error: 'Response not found', reason: 'not_found' }
        const [row] = await tx
          .select({
            id: formResponses.id,
            status: formResponses.status,
            locked: formResponses.locked,
            submittedBy: formResponses.submittedBy,
            data: formResponses.data,
            draftData: formResponses.draftData,
            schema: formTemplateVersions.schema,
          })
          .from(formResponses)
          .innerJoin(
            formTemplateVersions,
            eq(formResponses.templateVersionId, formTemplateVersions.id),
          )
          .where(
            and(
              eq(formResponses.id, request.responseId),
              eq(formResponses.tenantId, ctx.tenantId),
              isNull(formResponses.deletedAt),
            ),
          )
          .limit(1)

        if (!row) return { ok: false, error: 'Response not found', reason: 'not_found' }
        if (row.locked) return { ok: false, error: 'This record is locked', reason: 'locked' }
        if (!canEditResponsePayload(ctx, row)) {
          return {
            ok: false,
            error: 'You do not have permission to edit this record',
            reason: 'forbidden',
          }
        }

        // Field ids must be top-level fields or repeating-section ids (whose
        // value is the whole row array).
        const schema = row.schema
        const topLevelFields = new Set(
          schema.sections.flatMap((sec) => (sec.repeating ? [] : sec.fields.map((f) => f.id))),
        )
        const sectionIds = new Set(
          schema.sections.flatMap((sec) => (sec.repeating ? [sec.id] : [])),
        )
        if (
          request.patches.some((p) => !topLevelFields.has(p.fieldId) && !sectionIds.has(p.fieldId))
        ) {
          return { ok: false, error: 'Unknown field', reason: 'invalid' }
        }

        const existing = responsePayload(
          row.data ?? {},
          row.draftData as FormResponseDraftData | null,
        )
        const accepted = new Map<string, unknown>()
        const alreadyStored: Array<{ fieldId: string; stored: unknown }> = []
        const conflicts: Array<{ fieldId: string; current: unknown }> = []
        for (const patch of request.patches) {
          const current = existing[patch.fieldId]
          if (jsonEqual(current, patch.base)) {
            accepted.set(patch.fieldId, patch.value)
            continue
          }
          // Retried after a lost response: the stored value already matches.
          const normalized = normalizeFormResponseData(
            schema,
            Object.fromEntries([...Object.entries(existing), [patch.fieldId, patch.value]]),
          )
          if (jsonEqual(current, normalized[patch.fieldId])) {
            alreadyStored.push({ fieldId: patch.fieldId, stored: current })
          } else {
            conflicts.push({ fieldId: patch.fieldId, current: current ?? null })
          }
        }
        if (accepted.size === 0) {
          return {
            ok: true,
            kind: 'fields',
            applied: alreadyStored,
            conflicts,
            rejected: [],
            wrote: false,
          }
        }

        // Object.fromEntries defines every key as an own data property, so even
        // a malformed legacy schema containing "__proto__" cannot alter the
        // payload object's prototype. Field ids were proven against the schema.
        const rawData = Object.fromEntries([...Object.entries(existing), ...accepted.entries()])
        const validationStage =
          row.status === 'draft' || row.status === 'in_progress' ? 'draft' : 'submit'
        const isTargetError = (error: { fieldId: string; sectionId?: string }) =>
          [...accepted.keys()].some((fieldId) =>
            sectionIds.has(fieldId)
              ? error.sectionId === fieldId || error.fieldId.startsWith(`${fieldId}.`)
              : error.fieldId === fieldId,
          )
        const rawFieldErrors = validateResponse(schema, rawData, validationStage).filter(
          isTargetError,
        )
        if (rawFieldErrors.length > 0) {
          return {
            ok: false,
            error: rawFieldErrors[0]?.message ?? 'Invalid field value',
            reason: 'invalid',
          }
        }
        const newData = normalizeFormResponseData(schema, rawData)
        const fieldErrors = validateResponse(schema, newData, validationStage).filter(isTargetError)
        if (fieldErrors.length > 0) {
          return {
            ok: false,
            error: fieldErrors[0]?.message ?? 'Invalid field value',
            reason: 'invalid',
          }
        }

        // Recompute compliance from the merged payload. Hoist repeating-section
        // rows so section-aware score operators resolve (same as submit).
        const rows: Record<string, Array<Record<string, unknown>>> = {}
        for (const sec of schema.sections) {
          if (!sec.repeating) continue
          const v = newData[sec.id]
          rows[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
        }
        const verdict = computeFormScore(schema, newData, rows)

        const ownerUnchanged =
          row.submittedBy === null
            ? isNull(formResponses.submittedBy)
            : eq(formResponses.submittedBy, row.submittedBy)
        const [updated] = await tx
          .update(formResponses)
          .set({
            data: newData,
            draftData: null,
            draftUpdatedAt: null,
            complianceScore: String(verdict.score),
            complianceStatus: verdict.status,
            // First edit on a fresh draft promotes it to in_progress so list
            // views distinguish an empty shell from one being filled.
            ...(row.status === 'draft' ? { status: 'in_progress' as const } : {}),
            // Adopt ownership on the first edit if it was unset.
            ...(row.submittedBy === null && ctx.membership?.id
              ? { submittedBy: ctx.membership.id }
              : {}),
          })
          .where(
            and(
              eq(formResponses.id, request.responseId),
              eq(formResponses.tenantId, ctx.tenantId),
              eq(formResponses.status, row.status),
              eq(formResponses.locked, false),
              isNull(formResponses.deletedAt),
              ownerUnchanged,
            ),
          )
          .returning({ id: formResponses.id })

        if (!updated) {
          return {
            ok: false,
            error: 'This record changed before it could be saved',
            reason: 'unavailable',
          }
        }

        return {
          ok: true,
          kind: 'fields',
          applied: [
            ...alreadyStored,
            ...[...accepted.keys()].map((fieldId) => ({
              fieldId,
              stored: newData[fieldId] ?? null,
            })),
          ],
          conflicts,
          rejected: [],
          wrote: true,
        }
      },
    )

    if (!result.ok) return result
    const { wrote, ...response } = result
    if (wrote) {
      await recordAudit(ctx, {
        entityType: 'form_response',
        entityId: request.responseId,
        action: 'update',
        summary: 'Updated record',
      })
      revalidatePath('/apps/responses/' + request.responseId)
    }
    return response
  } catch (err) {
    if (isFormResponseParentLockedError(err)) {
      return { ok: false, error: err.message, reason: 'locked' }
    }
    console.error('[forms] record field save failed', err)
    return { ok: false, error: 'Unable to save right now.', reason: 'unavailable' }
  }
}
