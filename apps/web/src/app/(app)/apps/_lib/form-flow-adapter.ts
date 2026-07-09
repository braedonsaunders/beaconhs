import 'server-only'

// The FORM-template FlowSubjectAdapter — reproduces the original form-coupled
// executor behaviour exactly, so existing Builder flows are byte-identical after
// the generic-executor refactor. Submitter = form_responses.submittedBy; CAPA/
// incident spawn via the existing …FromResponse primitives; set_field/flag write
// back to form_responses.data/complianceStatus; gates persist to the shared
// flow_gates store (via the executor); the three forms-only actions
// (create_response / analyze_photos / start_monitored_session) run here.

import { desc, eq, inArray } from 'drizzle-orm'
import {
  SKIP_FIELD_TYPES,
  evaluateFormulaTree,
  hasImageCompanion,
  hasPhotosCompanion,
  hasTextCompanion,
  resolveDefaultValue,
  type ActionData,
  type EvalContext,
  type FormSchemaV1,
} from '@beaconhs/forms-core'
import { loadEntitiesForFormPickers } from '@beaconhs/db'
import {
  formResponses,
  formTemplateVersions,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { interpolate } from '@beaconhs/email-render'
import { spawnCorrectiveActionCore, spawnIncidentCore } from '@/app/(app)/apps/_lib/spawn-core'
import { analyzePhotoAttachments } from '@/app/(app)/apps/_lib/analyze-photos'
import {
  nestedPhotoRows,
  renderFormFieldText,
  sketchImageUrl,
} from '@/lib/flows/form-subject-values'
import { personName } from '@/lib/flows/format'
import { buildRecordSummaryPdfJob } from '@/lib/flows/pdf-summary'
import type { ExtraActionHelpers, FlowSubjectAdapter } from '@/lib/flows/types'

const SEVERITY_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3 }

// Valid form_response.status values — guards the dynamic `change_status` action
// against writing a value outside the enum.
const RESPONSE_STATUSES = [
  'draft',
  'in_progress',
  'submitted',
  'in_review',
  'closed',
  'rejected',
  'non_compliant',
] as const
type ResponseStatus = (typeof RESPONSE_STATUSES)[number]

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
    deepLink: () => `/apps/responses/${responseId}`,
    // FALLBACK only — the executor prefers the form template's own PDF
    // document template and calls this when none is assigned.
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: responseId,
        entityType: 'form_response',
        heading: 'Form response',
        reference: responseId.slice(0, 8),
        subtitle: values.title,
        values,
      }),

    async loadValues() {
      const [resp] = await ctx.db((tx) =>
        tx
          .select({
            data: formResponses.data,
            score: formResponses.complianceScore,
            status: formResponses.complianceStatus,
            templateVersionId: formResponses.templateVersionId,
          })
          .from(formResponses)
          .where(eq(formResponses.id, responseId))
          .limit(1),
      )
      const data = (resp?.data as Record<string, unknown> | null) ?? {}
      // Raw field values stay byte-identical (conditions, recipient `field`
      // targets, and analyze_photos all read them). Human-readable COMPANION
      // keys (<id>_text / <id>_image / <id>_photos) are ADDED below so PDF /
      // email templates render fields the way the bespoke form PDF did.
      const out: Record<string, unknown> = {
        ...data,
        compliance_score: resp?.score != null ? Number(resp.score) : null,
        compliance_status: resp?.status ?? null,
      }
      if (!resp) return out

      const [ver] = await ctx.db((tx) =>
        tx
          .select({ schema: formTemplateVersions.schema })
          .from(formTemplateVersions)
          .where(eq(formTemplateVersions.id, resp.templateVersionId))
          .limit(1),
      )
      const schema = ver?.schema as FormSchemaV1 | undefined
      if (!schema) return out

      // Picker-bound entity attrs — the same loader the bespoke PDF render
      // uses, so `<picker>_text` shows the identical resolved display name.
      const entities = await ctx.db((tx) => loadEntitiesForFormPickers(tx, schema, data))

      // Resolve multi_person_picker selections to names in one batched query.
      const multiPersonIds = new Set<string>()
      for (const sec of schema.sections ?? []) {
        if (sec.repeating) continue
        for (const f of sec.fields ?? []) {
          if (f.type !== 'multi_person_picker') continue
          const raw = data[f.id]
          if (Array.isArray(raw)) {
            for (const id of raw) if (typeof id === 'string' && id) multiPersonIds.add(id)
          }
        }
      }
      const personNames = new Map<string, string>()
      if (multiPersonIds.size > 0) {
        const rows = await ctx.db((tx) =>
          tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              formalName: people.formalName,
            })
            .from(people)
            .where(inArray(people.id, [...multiPersonIds])),
        )
        for (const p of rows) personNames.set(p.id, personName(p))
      }

      // Formula/calc fields are computed, never stored — evaluate them here so
      // templates print the same fresh values the bespoke PDF recomputed.
      const rowsMap: Record<string, Array<Record<string, unknown>>> = {}
      for (const sec of schema.sections ?? []) {
        if (!sec.repeating) continue
        const v = data[sec.id]
        rowsMap[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
      }
      const evalCtx: EvalContext = { values: data, rows: rowsMap, entities }

      for (const sec of schema.sections ?? []) {
        if (sec.repeating) continue
        for (const f of sec.fields ?? []) {
          if (SKIP_FIELD_TYPES.has(f.type)) continue
          let raw = data[f.id]
          if ((f.type === 'formula' || f.type === 'calc') && f.formula) {
            raw = evaluateFormulaTree(f.formula, evalCtx)
            out[f.id] = raw ?? null
          }
          if (hasTextCompanion(f.type)) {
            out[`${f.id}_text`] = renderFormFieldText(f, raw, {
              entityAttrs: entities[f.id] ?? null,
              personNameById: (id) => personNames.get(id),
            })
          }
          if (hasImageCompanion(f.type)) out[`${f.id}_image`] = sketchImageUrl(raw)
          if (hasPhotosCompanion(f.type)) out[`${f.id}_photos`] = nestedPhotoRows(raw)
        }
      }
      return out
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

    // Flow-initiated spawns are TENANT-AUTHORITATIVE: the automation was
    // authored by a template admin, so it must not silently no-op when the
    // submitting user lacks ca.create / incidents.create. The core records
    // dual attribution (actor = triggering user, initiatedBy = 'flow').
    spawnCorrectiveAction: (i) =>
      spawnCorrectiveActionCore(ctx, {
        responseId,
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
        initiatedBy: 'flow',
      }),

    spawnIncident: (i) =>
      spawnIncidentCore(ctx, { responseId, title: i.title, initiatedBy: 'flow' }),

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
            const res = await spawnCorrectiveActionCore(ctx, {
              responseId,
              title: `Photo hazard: ${top.type}`.slice(0, 120),
              description:
                analysis.summary +
                '\n\n' +
                bad.map((h) => `• ${h.type} (${h.severity}) — ${h.detail}`).join('\n'),
              severity: sev as 'low' | 'medium' | 'high' | 'critical',
              initiatedBy: 'flow',
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

      // Transition the record's workflow status (and optionally lock it). Used by
      // manual action buttons (e.g. "Close + lock") and automated status flows.
      if (action.action === 'change_status') {
        if (!(RESPONSE_STATUSES as readonly string[]).includes(action.to)) {
          failed.push('change_status (invalid status)')
          return { ran, failed }
        }
        const set: Record<string, unknown> = { status: action.to as ResponseStatus }
        if (action.lock) {
          set.locked = true
          set.lockedAt = new Date()
          set.lockedByTenantUserId = ctx.membership?.id ?? null
        }
        await ctx.db((tx) =>
          tx.update(formResponses).set(set).where(eq(formResponses.id, responseId)),
        )
        ran.push(`change_status→${action.to}`)
        return { ran, failed }
      }

      // Clone this record into a fresh draft (same template version + data).
      if (action.action === 'duplicate_record') {
        const [src] = await ctx.db((tx) =>
          tx
            .select({
              templateId: formResponses.templateId,
              templateVersionId: formResponses.templateVersionId,
              data: formResponses.data,
              siteOrgUnitId: formResponses.siteOrgUnitId,
              subjectPersonId: formResponses.subjectPersonId,
            })
            .from(formResponses)
            .where(eq(formResponses.id, responseId))
            .limit(1),
        )
        if (!src) {
          failed.push('duplicate_record (source not found)')
          return { ran, failed }
        }
        await ctx.db((tx) =>
          tx.insert(formResponses).values({
            tenantId: ctx.tenantId,
            templateId: src.templateId,
            templateVersionId: src.templateVersionId,
            status: 'draft',
            data: (src.data as Record<string, unknown>) ?? {},
            siteOrgUnitId: src.siteOrgUnitId,
            subjectPersonId: src.subjectPersonId,
            submittedBy: ctx.membership?.id ?? null,
          }),
        )
        ran.push('duplicate_record')
        return { ran, failed }
      }

      // Render + store this record's PDF in the worker (manual PDF buttons
      // navigate to the /pdf route directly; in a flow this stores one). Same
      // resolution as the route: the form's own PDF document template when one
      // is assigned, else the generic record summary.
      if (action.action === 'export_pdf') {
        try {
          const { enqueuePdf } = await import('@beaconhs/jobs')
          const { resolveSubjectDefaultPdfTemplate } = await import('@/lib/pdf-templates')
          const { renderTemplate } = await import('@beaconhs/email-render')
          const tpl = await resolveSubjectDefaultPdfTemplate(ctx, {
            subjectType: 'form_template',
            subjectKey: null,
            subjectId: responseId,
          })
          if (tpl) {
            const headerVals = { ...values, page: '{{page}}', pages: '{{pages}}' }
            await enqueuePdf({
              kind: 'template_pdf',
              tenantId: ctx.tenantId,
              html: renderTemplate(tpl.compiledHtml, values, { escapeHtml: true }),
              paperSize: tpl.paperSize,
              orientation: tpl.orientation,
              marginMm: tpl.marginMm,
              headerHtml: tpl.headerHtml
                ? renderTemplate(tpl.headerHtml, headerVals, { escapeHtml: false })
                : null,
              footerHtml: tpl.footerHtml
                ? renderTemplate(tpl.footerHtml, headerVals, { escapeHtml: false })
                : null,
              entityType: 'form_response',
              entityId: responseId,
            })
          } else {
            await enqueuePdf(
              buildRecordSummaryPdfJob({
                tenantId: ctx.tenantId,
                subjectId: responseId,
                entityType: 'form_response',
                heading: 'Form response',
                reference: responseId.slice(0, 8),
                subtitle: values.title,
                values,
              }),
            )
          }
          ran.push('export_pdf')
        } catch {
          failed.push('export_pdf (error)')
        }
        return { ran, failed }
      }

      return { ran, failed }
    },
  }
}
