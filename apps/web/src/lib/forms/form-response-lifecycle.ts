import 'server-only'

import { and, desc, eq, sql } from 'drizzle-orm'
import {
  formAutomations,
  formResponseScores,
  formResponses,
  formTemplateVersions,
  formTemplates,
  people,
} from '@beaconhs/db/schema'
import { extractScores, validateResponse, type ValidationError } from '@beaconhs/forms-core'
import { emitFormSubmitted } from '@beaconhs/integrations'
import type { RequestContext } from '@beaconhs/tenant'
import { computeFormScore, type ComputeFormScoreResult } from '@/app/(app)/apps/_lib/score-router'
import { repopulateParticipants } from '@/app/(app)/apps/_lib/participants'
import { sendFormResponseRecapEmail } from '@/app/(app)/apps/_lib/recap-email'
import { runOnSubmitAutomations } from '@/app/(app)/apps/_lib/run-automations'
import { recordAudit } from '@/lib/audit'

export type SubmitFormResponseLifecycleInput = {
  templateId: string
  data: Record<string, unknown>
  siteOrgUnitId?: string | null
  subjectPersonId?: string | null
  responseId?: string | null
}

export type SubmitFormResponseLifecycleResult =
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
    const [version] = await tx
      .select()
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, args.templateId))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    if (!version) return { ok: false as const, errors: [{ fieldId: '', message: 'No version' }] }

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
    if (args.responseId) {
      const [existing] = await tx
        .select({
          id: formResponses.id,
          status: formResponses.status,
          templateId: formResponses.templateId,
        })
        .from(formResponses)
        .where(and(eq(formResponses.id, args.responseId), eq(formResponses.tenantId, ctx.tenantId)))
        .limit(1)

      if (existing && existing.templateId !== args.templateId) {
        return {
          ok: false as const,
          errors: [{ fieldId: '', message: 'Response belongs to a different template' }],
        }
      }

      if (existing && (existing.status === 'draft' || existing.status === 'in_progress')) {
        const [updated] = await tx
          .update(formResponses)
          .set({
            status: finalStatus,
            siteOrgUnitId: args.siteOrgUnitId ?? null,
            subjectPersonId: args.subjectPersonId ?? null,
            submittedBy: ctx.membership?.id ?? null,
            submittedAt,
            data: args.data,
            complianceScore: String(verdict.score),
            complianceStatus: verdict.status,
            draftData: null,
            draftUpdatedAt: null,
            draftStepIndex: null,
          })
          .where(eq(formResponses.id, args.responseId))
          .returning({ id: formResponses.id })
        resp = updated
      }
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

      const monitor = version.schema.monitor
      if (monitor?.enabled) {
        const [flowStart] = await tx
          .select({ id: formAutomations.id })
          .from(formAutomations)
          .where(
            and(
              eq(formAutomations.templateId, args.templateId),
              eq(formAutomations.enabled, true),
              sql`${formAutomations.graph}::text like '%start_monitored_session%'`,
            ),
          )
          .limit(1)
        if (!flowStart) {
          const numField = (key: string | undefined, fallback: number): number => {
            if (key) {
              const value = Number(args.data[key])
              if (Number.isFinite(value) && value > 0) return value
            }
            return fallback
          }
          const interval = numField(monitor.intervalFieldKey, monitor.intervalMinutes)
          const grace =
            monitor.graceFieldKey && Number.isFinite(Number(args.data[monitor.graceFieldKey]))
              ? Math.max(0, Number(args.data[monitor.graceFieldKey]))
              : monitor.graceMinutes
          const duration = numField(monitor.durationFieldKey, monitor.durationMinutes ?? 0)
          await tx
            .update(formResponses)
            .set({
              monitorStatus: 'active',
              checkinIntervalMinutes: interval,
              gracePeriodMinutes: grace,
              monitorRequireGeo: !!monitor.requireGeo,
              lastCheckinAt: submittedAt,
              nextCheckinDueAt: new Date(submittedAt.getTime() + interval * 60_000),
              expectedEndAt:
                duration > 0 ? new Date(submittedAt.getTime() + duration * 60_000) : null,
            })
            .where(eq(formResponses.id, resp.id))
        }
      }
    }

    return {
      ok: true as const,
      responseId: resp?.id,
      templateName: tmpl?.name ?? null,
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

  try {
    await sendFormResponseRecapEmail(ctx, result.responseId)
  } catch {
    // Best-effort only.
  }

  try {
    await runOnSubmitAutomations(ctx, {
      templateId: args.templateId,
      responseId: result.responseId,
      data: args.data,
      score: result.verdict.score,
      status: result.verdict.status,
    })
  } catch {
    // Best-effort only.
  }

  try {
    await emitFormSubmitted(ctx, {
      id: result.responseId,
      templateId: args.templateId,
      templateName: result.templateName,
      status: result.verdict.status,
      submittedAt: result.submittedAt,
      complianceScore: result.verdict.score,
      complianceStatus: result.verdict.status,
      data: args.data,
    })
  } catch {
    // Best-effort only.
  }

  return {
    ok: true,
    responseId: result.responseId,
    verdict: result.verdict,
    submittedAt: result.submittedAt,
  }
}
