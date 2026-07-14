import 'server-only'

import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { isFormResponseParentLockedError, lockFormResponseForMutation } from '@beaconhs/db'
import {
  formResponseScores,
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  tenantUsers,
} from '@beaconhs/db/schema'
import {
  extractScores,
  normalizeFormResponseData,
  validateResponse,
  type ValidationError,
} from '@beaconhs/forms-core'
import { recordDomainEvent } from '@beaconhs/events'
import { formSubmittedEvent } from '@beaconhs/integrations'
import type { RequestContext } from '@beaconhs/tenant'
import { canEditResponsePayload } from '@/app/(app)/apps/_lib/access-policy'
import { computeFormScore, type ComputeFormScoreResult } from '@/app/(app)/apps/_lib/score-router'
import { repopulateParticipants } from '@/app/(app)/apps/_lib/participants'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { collectResponseEntityReferences } from './response-entity-references'
import { loadApplicableFormObligation, loadFormObligation } from './form-compliance-obligation'
import { materializeFormResponseEvidenceChange } from './form-response-evidence'

type SubmitFormResponseLifecycleInput = {
  templateId: string
  data: Record<string, unknown>
  siteOrgUnitId?: string | null
  subjectPersonId?: string | null
  responseId?: string | null
  complianceObligationId?: string | null
}

type SubmitFormResponseLifecycleResult =
  | {
      ok: true
      responseId: string
      verdict: ComputeFormScoreResult
      submittedAt: Date
    }
  | { ok: false; errors: ValidationError[] }

function repeatingRows(
  schema: typeof formTemplateVersions.$inferSelect.schema,
  data: Record<string, unknown>,
): Record<string, Array<Record<string, unknown>>> {
  const rows: Record<string, Array<Record<string, unknown>>> = {}
  for (const sec of schema.sections) {
    if (!sec.repeating) continue
    const value = data[sec.id]
    rows[sec.id] = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
  }
  return rows
}

/**
 * Shared submit lifecycle for Builder form responses.
 *
 * The public API and the app filler both need the same behavior: schema
 * validation, compliance scoring, score extraction, participant indexing,
 * monitored-session startup, audit, recap email, automations, and outbound
 * integration events. Keep those side effects centralized here so a Builder app
 * submitted over REST is indistinguishable from one submitted through the UI.
 */
export async function submitFormResponseLifecycle(
  ctx: RequestContext,
  args: SubmitFormResponseLifecycleInput,
): Promise<SubmitFormResponseLifecycleResult> {
  for (const [fieldId, value] of [
    ['templateId', args.templateId],
    ['responseId', args.responseId],
    ['siteOrgUnitId', args.siteOrgUnitId],
    ['subjectPersonId', args.subjectPersonId],
    ['complianceObligationId', args.complianceObligationId],
  ] as const) {
    if (value != null && !isUuid(value)) {
      return { ok: false, errors: [{ fieldId, message: 'Must be a valid identifier' }] }
    }
  }

  const result = await ctx.db(async (tx) => {
    let existing: typeof formResponses.$inferSelect | null = null
    if (args.responseId) {
      try {
        existing = await lockFormResponseForMutation(tx, ctx.tenantId, args.responseId)
      } catch (error) {
        if (isFormResponseParentLockedError(error)) {
          return {
            ok: false as const,
            errors: [{ fieldId: '', message: error.message }],
          }
        }
        throw error
      }
    }

    if (args.responseId && !existing) {
      return {
        ok: false as const,
        errors: [{ fieldId: '', message: 'Response not found' }],
      }
    }
    if (existing && existing.templateId !== args.templateId) {
      return {
        ok: false as const,
        errors: [{ fieldId: '', message: 'Response belongs to a different template' }],
      }
    }
    if (
      existing?.complianceObligationId &&
      args.complianceObligationId &&
      existing.complianceObligationId !== args.complianceObligationId
    ) {
      return {
        ok: false as const,
        errors: [{ fieldId: 'complianceObligationId', message: 'Response task cannot be changed' }],
      }
    }
    if (existing && existing.status !== 'draft' && existing.status !== 'in_progress') {
      return {
        ok: false as const,
        errors: [{ fieldId: '', message: 'Response was already submitted' }],
      }
    }
    if (existing && !canEditResponsePayload(ctx, existing)) {
      return {
        ok: false as const,
        errors: [{ fieldId: '', message: 'You do not have permission to submit this response' }],
      }
    }

    const [tmpl] = await tx
      .select({
        id: formTemplates.id,
        category: formTemplates.category,
        name: formTemplates.name,
      })
      .from(formTemplates)
      .where(
        and(
          eq(formTemplates.id, args.templateId),
          eq(formTemplates.tenantId, ctx.tenantId),
          eq(formTemplates.status, 'published'),
          isNull(formTemplates.deletedAt),
        ),
      )
      .limit(1)
    if (!tmpl) {
      return {
        ok: false as const,
        errors: [{ fieldId: 'templateId', message: 'Published app not found' }],
      }
    }

    const complianceObligationId =
      existing?.complianceObligationId ?? args.complianceObligationId ?? null
    const linkedObligation = complianceObligationId
      ? existing?.complianceObligationId
        ? await loadFormObligation(tx, {
            tenantId: ctx.tenantId,
            obligationId: complianceObligationId,
            templateId: args.templateId,
          })
        : await loadApplicableFormObligation(tx, {
            tenantId: ctx.tenantId,
            obligationId: complianceObligationId,
            templateId: args.templateId,
            personId: ctx.personId,
          })
      : null
    if (complianceObligationId && !linkedObligation) {
      return {
        ok: false as const,
        errors: [
          {
            fieldId: 'complianceObligationId',
            message: 'This compliance task is not assigned to you',
          },
        ],
      }
    }

    const [version] = existing
      ? await tx
          .select()
          .from(formTemplateVersions)
          .where(
            and(
              eq(formTemplateVersions.id, existing.templateVersionId),
              eq(formTemplateVersions.templateId, args.templateId),
              eq(formTemplateVersions.tenantId, ctx.tenantId),
              isNotNull(formTemplateVersions.publishedAt),
            ),
          )
          .limit(1)
      : await tx
          .select()
          .from(formTemplateVersions)
          .where(
            and(
              eq(formTemplateVersions.templateId, args.templateId),
              eq(formTemplateVersions.tenantId, ctx.tenantId),
              isNotNull(formTemplateVersions.publishedAt),
            ),
          )
          .orderBy(desc(formTemplateVersions.version))
          .limit(1)
    if (!version) {
      return {
        ok: false as const,
        errors: [{ fieldId: '', message: existing ? 'Response version not found' : 'No version' }],
      }
    }
    // Validate the caller-controlled payload before normalization. The
    // normalizer intentionally removes unknown keys, so validating only the
    // normalized object would silently accept fields that are not in the
    // published schema.
    const rawErrors = validateResponse(version.schema, args.data, 'submit')
    if (rawErrors.length > 0) return { ok: false as const, errors: rawErrors }

    const data = normalizeFormResponseData(version.schema, args.data)

    // Sanitization can turn a previously non-empty value into an empty one.
    // Revalidate the canonical payload before scoring or persistence.
    const errors = validateResponse(version.schema, data, 'submit')
    if (errors.length > 0) return { ok: false as const, errors }

    const entityRefs = collectResponseEntityReferences(version.schema, data)
    const personIds = [
      ...new Set(entityRefs.filter((ref) => ref.kind === 'person').map((r) => r.id)),
    ]
    const orgUnitIds = [
      ...new Set(entityRefs.filter((ref) => ref.kind === 'org_unit').map((r) => r.id)),
    ]
    if (personIds.length + orgUnitIds.length > 5_000) {
      return {
        ok: false as const,
        errors: [{ fieldId: '', message: 'Response contains too many entity references' }],
      }
    }
    const [validPeople, validOrgUnits] = await Promise.all([
      personIds.length
        ? tx
            .select({ id: people.id })
            .from(people)
            .where(
              and(
                eq(people.tenantId, ctx.tenantId),
                inArray(people.id, personIds),
                eq(people.status, 'active'),
                isNull(people.deletedAt),
              ),
            )
        : Promise.resolve([]),
      orgUnitIds.length
        ? tx
            .select({ id: orgUnits.id, level: orgUnits.level })
            .from(orgUnits)
            .where(
              and(
                eq(orgUnits.tenantId, ctx.tenantId),
                inArray(orgUnits.id, orgUnitIds),
                isNull(orgUnits.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ])
    const peopleFound = new Set(validPeople.map((row) => row.id))
    const orgUnitsFound = new Map(validOrgUnits.map((row) => [row.id, row.level]))
    const referenceErrors: ValidationError[] = []
    for (const ref of entityRefs) {
      if (
        ref.kind === 'person' ? !peopleFound.has(ref.id) : orgUnitsFound.get(ref.id) !== ref.level
      ) {
        referenceErrors.push({
          fieldId: ref.fieldId,
          message:
            ref.kind === 'person'
              ? 'Selected person is not active in this workspace'
              : `Selected ${ref.level} is not available in this workspace`,
        })
      }
    }
    if (referenceErrors.length > 0) {
      return { ok: false as const, errors: referenceErrors }
    }

    const verdict = computeFormScore(version.schema, data, repeatingRows(version.schema, data))
    const finalStatus =
      verdict.status === 'non_compliant' ? ('non_compliant' as const) : ('submitted' as const)
    const submittedAt = new Date()

    const siteOrgUnitId =
      args.siteOrgUnitId === undefined ? (existing?.siteOrgUnitId ?? null) : args.siteOrgUnitId
    const subjectPersonId =
      args.subjectPersonId === undefined
        ? (existing?.subjectPersonId ?? null)
        : args.subjectPersonId
    const [site, subject] = await Promise.all([
      siteOrgUnitId
        ? tx
            .select({ id: orgUnits.id })
            .from(orgUnits)
            .where(
              and(
                eq(orgUnits.id, siteOrgUnitId),
                eq(orgUnits.tenantId, ctx.tenantId),
                isNull(orgUnits.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      subjectPersonId
        ? tx
            .select({ id: people.id })
            .from(people)
            .where(
              and(
                eq(people.id, subjectPersonId),
                eq(people.tenantId, ctx.tenantId),
                isNull(people.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
    ])
    if (siteOrgUnitId && !site[0]) {
      return {
        ok: false as const,
        errors: [{ fieldId: 'siteOrgUnitId', message: 'Site not found in this workspace' }],
      }
    }
    if (subjectPersonId && !subject[0]) {
      return {
        ok: false as const,
        errors: [{ fieldId: 'subjectPersonId', message: 'Person not found in this workspace' }],
      }
    }

    let resp: typeof formResponses.$inferSelect | undefined = undefined
    if (args.responseId && existing) {
      // A response that already left draft/in_progress must never fall through
      // to the insert branch — a double-click or replayed API POST would
      // duplicate the record and re-fire every submit side effect. The status
      // predicate on the UPDATE makes the transition atomic, so concurrent
      // submits of the same draft can only ever fire the lifecycle once.
      const ownerUnchanged =
        existing.submittedBy === null
          ? isNull(formResponses.submittedBy)
          : eq(formResponses.submittedBy, existing.submittedBy)
      const [updated] = await tx
        .update(formResponses)
        .set({
          status: finalStatus,
          siteOrgUnitId,
          subjectPersonId,
          complianceObligationId,
          // A reviewer may finalize somebody else's draft, but that must not
          // rewrite who originally submitted it. An unowned system draft is
          // claimed only when a real tenant member performs the submission.
          submittedBy: existing.submittedBy ?? ctx.membership?.id ?? null,
          submittedAt,
          data,
          complianceScore: String(verdict.score),
          complianceStatus: verdict.status,
          draftData: null,
          draftUpdatedAt: null,
          draftStepIndex: null,
        })
        .where(
          and(
            eq(formResponses.id, args.responseId),
            eq(formResponses.templateId, args.templateId),
            eq(formResponses.templateVersionId, existing.templateVersionId),
            inArray(formResponses.status, ['draft', 'in_progress']),
            eq(formResponses.locked, false),
            isNull(formResponses.deletedAt),
            ownerUnchanged,
          ),
        )
        .returning()
      if (!updated) {
        return {
          ok: false as const,
          errors: [{ fieldId: '', message: 'Response changed before it could be submitted' }],
        }
      }
      resp = updated
    }

    if (!resp) {
      const [inserted] = await tx
        .insert(formResponses)
        .values({
          tenantId: ctx.tenantId,
          templateId: args.templateId,
          templateVersionId: version.id,
          status: finalStatus,
          siteOrgUnitId,
          subjectPersonId,
          complianceObligationId,
          submittedBy: ctx.membership?.id ?? null,
          submittedAt,
          data,
          complianceScore: String(verdict.score),
          complianceStatus: verdict.status,
        })
        .returning()
      resp = inserted
    }

    if (resp) {
      if (existing) {
        // Inline editing may already have materialized score rows. Submission
        // replaces that snapshot; it must not append duplicate field scores.
        await tx.delete(formResponseScores).where(eq(formResponseScores.responseId, resp.id))
      }
      const scores = extractScores(version.schema, data)
      if (scores.length > 0) {
        await tx.insert(formResponseScores).values(
          scores.map((score) => ({
            tenantId: ctx.tenantId,
            responseId: resp.id,
            fieldId: score.fieldId,
            sectionId: score.sectionId,
            score: score.score,
            label: score.label,
            weight: score.weight,
          })),
        )
      }

      const effectiveSubmitterMembershipId = existing?.submittedBy ?? ctx.membership?.id ?? null
      const [submitterPerson] = effectiveSubmitterMembershipId
        ? await tx
            .select({ id: people.id })
            .from(tenantUsers)
            .innerJoin(
              people,
              and(eq(people.tenantId, tenantUsers.tenantId), eq(people.userId, tenantUsers.userId)),
            )
            .where(
              and(
                eq(tenantUsers.tenantId, ctx.tenantId),
                eq(tenantUsers.id, effectiveSubmitterMembershipId),
                isNull(people.deletedAt),
              ),
            )
            .limit(1)
        : []
      await repopulateParticipants(tx, {
        tenantId: ctx.tenantId,
        responseId: resp.id,
        templateId: args.templateId,
        category: tmpl.category,
        schema: version.schema,
        data,
        submittedAt,
        submitterPersonId: submitterPerson?.id ?? null,
      })

      await materializeFormResponseEvidenceChange(tx, ctx.tenantId, existing, resp)

      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'form.submitted',
        subjectId: resp.id,
        dedupKey: `form.submitted:${resp.id}:${submittedAt.toISOString()}`,
        payload: {
          integration: formSubmittedEvent(ctx.tenantId, {
            id: resp.id,
            templateId: args.templateId,
            templateName: tmpl.name,
            status: verdict.status,
            submittedAt,
            complianceScore: verdict.score,
            complianceStatus: verdict.status,
            data,
          }),
          web: {
            kind: 'form_submitted',
            subjectId: resp.id,
            templateId: args.templateId,
            data,
            score: verdict.score,
            status: verdict.status,
            recap: true,
            actor: {
              userId: ctx.userId,
              membershipId: ctx.membership?.id ?? null,
              personId: ctx.personId,
              timezone: ctx.timezone,
            },
          },
        },
      })
    }

    return {
      ok: true as const,
      responseId: resp?.id,
      verdict,
      submittedAt,
    }
  })

  if (!result.ok) return result
  if (!result.responseId) throw new Error('Failed to submit form response')

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: result.responseId,
    action: 'create',
    summary:
      result.verdict.status === 'non_compliant'
        ? `Form submitted (auto-flagged non-compliant, score ${result.verdict.score})`
        : 'Form submitted',
    metadata: {
      complianceScore: result.verdict.score,
      complianceStatus: result.verdict.status,
      failedFieldKeys: result.verdict.failedFieldKeys,
    },
  })

  return {
    ok: true,
    responseId: result.responseId,
    verdict: result.verdict,
    submittedAt: result.submittedAt,
  }
}
