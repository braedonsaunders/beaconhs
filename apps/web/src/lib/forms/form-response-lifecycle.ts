import 'server-only'

import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  formResponseScores,
  formResponses,
  formTemplateVersions,
  formTemplates,
  people,
} from '@beaconhs/db/schema'
import { extractScores, validateResponse, type ValidationError } from '@beaconhs/forms-core'
import { recordDomainEvent } from '@beaconhs/events'
import { formSubmittedEvent } from '@beaconhs/integrations'
import type { RequestContext } from '@beaconhs/tenant'
import { canEditResponsePayload } from '@/app/(app)/apps/_lib/access-policy'
import { computeFormScore, type ComputeFormScoreResult } from '@/app/(app)/apps/_lib/score-router'
import { repopulateParticipants } from '@/app/(app)/apps/_lib/participants'
import { recordAudit } from '@/lib/audit'

type SubmitFormResponseLifecycleInput = {
  templateId: string
  data: Record<string, unknown>
  siteOrgUnitId?: string | null
  subjectPersonId?: string | null
  responseId?: string | null
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
  const result = await ctx.db(async (tx) => {
    const [existing] = args.responseId
      ? await tx
          .select({
            id: formResponses.id,
            templateId: formResponses.templateId,
            templateVersionId: formResponses.templateVersionId,
            status: formResponses.status,
            locked: formResponses.locked,
            submittedBy: formResponses.submittedBy,
            siteOrgUnitId: formResponses.siteOrgUnitId,
            subjectPersonId: formResponses.subjectPersonId,
          })
          .from(formResponses)
          .where(
            and(
              eq(formResponses.id, args.responseId),
              eq(formResponses.tenantId, ctx.tenantId),
              isNull(formResponses.deletedAt),
            ),
          )
          .limit(1)
      : []

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

    const [version] = existing
      ? await tx
          .select()
          .from(formTemplateVersions)
          .where(
            and(
              eq(formTemplateVersions.id, existing.templateVersionId),
              eq(formTemplateVersions.templateId, args.templateId),
            ),
          )
          .limit(1)
      : await tx
          .select()
          .from(formTemplateVersions)
          .where(eq(formTemplateVersions.templateId, args.templateId))
          .orderBy(desc(formTemplateVersions.version))
          .limit(1)
    if (!version) {
      return {
        ok: false as const,
        errors: [{ fieldId: '', message: existing ? 'Response version not found' : 'No version' }],
      }
    }

    const [tmpl] = await tx
      .select({ category: formTemplates.category, name: formTemplates.name })
      .from(formTemplates)
      .where(eq(formTemplates.id, args.templateId))
      .limit(1)

    const errors = validateResponse(version.schema, args.data, 'submit')
    if (errors.length > 0) return { ok: false as const, errors }

    const verdict = computeFormScore(
      version.schema,
      args.data,
      repeatingRows(version.schema, args.data),
    )
    const finalStatus =
      verdict.status === 'non_compliant' ? ('non_compliant' as const) : ('submitted' as const)
    const submittedAt = new Date()

    let resp: { id: string } | undefined = undefined
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
          siteOrgUnitId:
            args.siteOrgUnitId === undefined
              ? existing.siteOrgUnitId
              : (args.siteOrgUnitId ?? null),
          subjectPersonId:
            args.subjectPersonId === undefined
              ? existing.subjectPersonId
              : (args.subjectPersonId ?? null),
          // A reviewer may finalize somebody else's draft, but that must not
          // rewrite who originally submitted it. An unowned system draft is
          // claimed only when a real tenant member performs the submission.
          submittedBy: existing.submittedBy ?? ctx.membership?.id ?? null,
          submittedAt,
          data: args.data,
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
        .returning({ id: formResponses.id })
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
          siteOrgUnitId: args.siteOrgUnitId ?? null,
          subjectPersonId: args.subjectPersonId ?? null,
          submittedBy: ctx.membership?.id ?? null,
          submittedAt,
          data: args.data,
          complianceScore: String(verdict.score),
          complianceStatus: verdict.status,
        })
        .returning({ id: formResponses.id })
      resp = inserted
    }

    if (resp) {
      if (existing) {
        // Inline editing may already have materialized score rows. Submission
        // replaces that snapshot; it must not append duplicate field scores.
        await tx.delete(formResponseScores).where(eq(formResponseScores.responseId, resp.id))
      }
      const scores = extractScores(version.schema, args.data)
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

      const [submitterPerson] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.tenantId, ctx.tenantId), eq(people.userId, ctx.userId)))
        .limit(1)
      await repopulateParticipants(tx, {
        tenantId: ctx.tenantId,
        responseId: resp.id,
        templateId: args.templateId,
        category: tmpl?.category ?? null,
        schema: version.schema,
        data: args.data,
        submittedAt,
        submitterPersonId: submitterPerson?.id ?? null,
      })

      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'form.submitted',
        subjectId: resp.id,
        dedupKey: `form.submitted:${resp.id}:${submittedAt.toISOString()}`,
        payload: {
          integration: formSubmittedEvent(ctx.tenantId, {
            id: resp.id,
            templateId: args.templateId,
            templateName: tmpl?.name ?? null,
            status: verdict.status,
            submittedAt,
            complianceScore: verdict.score,
            complianceStatus: verdict.status,
            data: args.data,
          }),
          web: {
            kind: 'form_submitted',
            subjectId: resp.id,
            templateId: args.templateId,
            data: args.data,
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
