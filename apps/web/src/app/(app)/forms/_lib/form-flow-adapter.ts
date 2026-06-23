import 'server-only'

// The FORM-template FlowSubjectAdapter — reproduces the original form-coupled
// executor behaviour exactly, so existing Builder flows are byte-identical after
// the generic-executor refactor. Submitter = form_responses.submittedBy; CAPA/
// incident spawn via the existing …FromResponse primitives; set_field/flag write
// back to form_responses.data/complianceStatus; gates persist to the shared
// flow_gates store (via the executor); the three forms-only actions
// (create_response / analyze_photos / start_monitored_session) run here.

import { desc, eq } from 'drizzle-orm'
import { resolveDefaultValue, type ActionData } from '@beaconhs/forms-core'
import { formResponses, formTemplateVersions, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { interpolate } from '@beaconhs/email-render'
import {
  createCorrectiveActionFromResponse,
  createIncidentFromResponse,
} from '@/app/(app)/forms/responses/[id]/_spawn-actions'
import { analyzePhotoAttachments } from '@/app/(app)/forms/_lib/analyze-photos'
import type { ExtraActionHelpers, FlowSubjectAdapter } from '@/lib/flows/types'

const SEVERITY_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3 }

// Pull attachment ids out of a photo / photo_upload (AttachedFile[]) or photo_ai
// ({ attachments: AttachedFile[] }) field value.
function attachmentIdsFromValue(raw: unknown): string[] {
  const pick = (arr: unknown[]) =>
    arr
      .map((x) =>
        x && typeof x === 'object' ? (x as { attachmentId?: string }).attachmentId : null,
      )
      .filter((x): x is string => !!x)
  if (Array.isArray(raw)) return pick(raw)
  if (raw && typeof raw === 'object') {
    const atts = (raw as { attachments?: unknown }).attachments
    if (Array.isArray(atts)) return pick(atts)
  }
  return []
}

export function createFormFlowAdapter(ctx: RequestContext, responseId: string): FlowSubjectAdapter {
  return {
    subjectType: 'form_template',
    subjectKey: null,
    subjectId: responseId,
    notifyCategory: 'forms',
    auditEntityType: 'form_response',
    deepLink: () => `/forms/responses/${responseId}`,

    async loadValues() {
      const [resp] = await ctx.db((tx) =>
        tx
          .select({
            data: formResponses.data,
            score: formResponses.complianceScore,
            status: formResponses.complianceStatus,
          })
          .from(formResponses)
          .where(eq(formResponses.id, responseId))
          .limit(1),
      )
      return {
        ...((resp?.data as Record<string, unknown> | null) ?? {}),
        compliance_score: resp?.score != null ? Number(resp.score) : null,
        compliance_status: resp?.status ?? null,
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({ tuid: formResponses.submittedBy })
          .from(formResponses)
          .where(eq(formResponses.id, responseId))
          .limit(1),
      )
      const tuid = r?.tuid ?? null
      let email: string | null = null
      let userId: string | null = null
      if (tuid) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ email: users.email, userId: users.id })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, tuid))
            .limit(1),
        )
        email = u?.email ?? null
        userId = u?.userId ?? null
      }
      return { tenantUserId: tuid, email, userId }
    },

    spawnCorrectiveAction: (i) =>
      createCorrectiveActionFromResponse({
        responseId,
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
      }),

    spawnIncident: (i) => createIncidentFromResponse({ responseId, title: i.title }),

    async persistAfterRun({ fieldPatch, flagNonCompliant }) {
      await ctx.db(async (tx) => {
        const patch: Record<string, unknown> = {}
        if (Object.keys(fieldPatch).length > 0) {
          const [cur] = await tx
            .select({ data: formResponses.data })
            .from(formResponses)
            .where(eq(formResponses.id, responseId))
            .limit(1)
          patch.data = { ...(cur?.data ?? {}), ...fieldPatch }
        }
        if (flagNonCompliant) patch.complianceStatus = 'non_compliant'
        if (Object.keys(patch).length > 0) {
          await tx.update(formResponses).set(patch).where(eq(formResponses.id, responseId))
        }
      })
    },

    async handleExtraAction(
      action: ActionData,
      { values, fieldPatch, evalCtx }: ExtraActionHelpers,
    ) {
      const ran: string[] = []
      const failed: string[] = []

      if (action.action === 'create_response') {
        const [ver] = await ctx.db((tx) =>
          tx
            .select({ id: formTemplateVersions.id })
            .from(formTemplateVersions)
            .where(eq(formTemplateVersions.templateId, action.templateId))
            .orderBy(desc(formTemplateVersions.version))
            .limit(1),
        )
        if (!ver) {
          failed.push('create_response (no version)')
          return { ran, failed }
        }
        const data: Record<string, unknown> = {}
        if (action.prefill) {
          for (const [k, expr] of Object.entries(action.prefill)) {
            data[k] = resolveDefaultValue(expr, evalCtx)
          }
        }
        await ctx.db((tx) =>
          tx.insert(formResponses).values({
            tenantId: ctx.tenantId,
            templateId: action.templateId,
            templateVersionId: ver.id,
            status: 'draft',
            data,
          }),
        )
        ran.push('create_response')
        return { ran, failed }
      }

      if (action.action === 'analyze_photos') {
        const attIds = attachmentIdsFromValue(values[action.fieldId])
        if (attIds.length === 0) {
          failed.push('analyze_photos (no photos)')
          return { ran, failed }
        }
        const analysis = await analyzePhotoAttachments(ctx, attIds)
        if (!analysis) {
          failed.push('analyze_photos (AI unconfigured / unreadable)')
          return { ran, failed }
        }
        const badPpe = analysis.ppe.filter((p) => p.status !== 'present')
        if (action.storeInField) {
          const lines: string[] = [analysis.summary]
          if (analysis.hazards.length)
            lines.push(
              `Hazards: ${analysis.hazards.map((h) => `${h.type} (${h.severity})`).join('; ')}`,
            )
          if (badPpe.length) lines.push(`PPE: ${badPpe.map((p) => p.item).join(', ')}`)
          const summary = lines.filter(Boolean).join('\n')
          fieldPatch[action.storeInField] = summary
          values[action.storeInField] = summary
        }
        if (action.createCapaOnHazard) {
          const min = SEVERITY_ORDER[action.minSeverity ?? 'medium'] ?? 2
          const bad = analysis.hazards.filter((h) => (SEVERITY_ORDER[h.severity] ?? 0) >= min)
          const top = bad[0]
          if (top) {
            const sev = bad.some((h) => h.severity === 'high') ? 'high' : 'medium'
            const res = await createCorrectiveActionFromResponse({
              responseId,
              title: `Photo hazard: ${top.type}`.slice(0, 120),
              description:
                analysis.summary +
                '\n\n' +
                bad.map((h) => `• ${h.type} (${h.severity}) — ${h.detail}`).join('\n'),
              severity: sev as 'low' | 'medium' | 'high' | 'critical',
            })
            ran.push(res.ok ? 'analyze_photos→capa' : 'analyze_photos→capa (failed)')
          }
        }
        ran.push(`analyze_photos (${analysis.hazards.length}h/${badPpe.length}ppe)`)
        return { ran, failed }
      }

      if (action.action === 'start_monitored_session') {
        const numField = (key: string | undefined, fallback: number): number => {
          if (key) {
            const v = Number(values[key])
            if (Number.isFinite(v) && v > 0) return v
          }
          return fallback
        }
        const interval = numField(action.intervalFieldKey, action.intervalMinutes)
        const grace =
          action.graceFieldKey && Number.isFinite(Number(values[action.graceFieldKey]))
            ? Math.max(0, Number(values[action.graceFieldKey]))
            : action.graceMinutes
        const duration = numField(action.durationFieldKey, action.durationMinutes ?? 0)
        const now = new Date()
        await ctx.db((tx) =>
          tx
            .update(formResponses)
            .set({
              monitorStatus: 'active',
              checkinIntervalMinutes: interval,
              gracePeriodMinutes: grace,
              monitorRequireGeo: !!action.requireGeo,
              lastCheckinAt: now,
              nextCheckinDueAt: new Date(now.getTime() + interval * 60_000),
              expectedEndAt: duration > 0 ? new Date(now.getTime() + duration * 60_000) : null,
            })
            .where(eq(formResponses.id, responseId)),
        )
        ran.push('start_monitored_session')
        return { ran, failed }
      }

      return { ran, failed }
    },
  }
}
