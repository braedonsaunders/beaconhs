import 'server-only'

// A BLANK hazard assessment for on-site handwriting.
//
// Crews want the real checklist on paper — this type's hazards, PPE and
// questions — with every answer column empty so they can fill it in with a pen
// when a phone is not practical, then key it in later.
//
// It renders through the SAME chain as a real record: one tenant PDF template
// (subject module/hazid, `is_module_default = false`) merged with values built
// here. Deliberately ONE template, not one per assessment type — the
// type-awareness comes from the DATA fed into it, so nobody has to maintain a
// blank template per type.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidHazardSets,
  hazidHazards,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

/** The blank template's stable key within the hazid subject. */
export const HAZID_BLANK_TEMPLATE_KEY = 'hazid-blank-pdf'

type HazidBlankValues = Record<string, unknown>

/**
 * Build the merge values for a blank assessment of `typeId`, mirroring how
 * createAssessment seeds a real one: PPE and questions from the type, hazards
 * from its default hazard set. Every captured value is left empty.
 */
export async function buildBlankHazidValues(
  ctx: RequestContext,
  typeId: string | null,
): Promise<HazidBlankValues | null> {
  const type = typeId
    ? (
        await ctx.db((tx) =>
          tx
            .select()
            .from(hazidAssessmentTypes)
            .where(and(eq(hazidAssessmentTypes.id, typeId), isNull(hazidAssessmentTypes.deletedAt)))
            .limit(1),
        )
      )[0]
    : null
  if (typeId && !type) return null

  const [ppe, questions, hazards] = await Promise.all([
    type?.hasPPE
      ? ctx.db((tx) =>
          tx
            .select()
            .from(hazidAssessmentTypePPE)
            .where(eq(hazidAssessmentTypePPE.typeId, type.id))
            .orderBy(asc(hazidAssessmentTypePPE.entityOrder)),
        )
      : Promise.resolve([]),
    type?.hasQuestions
      ? ctx.db((tx) =>
          tx
            .select()
            .from(hazidAssessmentTypeQuestions)
            .where(eq(hazidAssessmentTypeQuestions.typeId, type.id))
            .orderBy(asc(hazidAssessmentTypeQuestions.entityOrder)),
        )
      : Promise.resolve([]),
    type?.style === 'hazard_based' && type.defaultHazardSetId
      ? ctx.db(async (tx) => {
          const [set] = await tx
            .select()
            .from(hazidHazardSets)
            .where(eq(hazidHazardSets.id, type.defaultHazardSetId!))
            .limit(1)
          if (!set || set.hazardIds.length === 0) return []
          const rows = await tx
            .select()
            .from(hazidHazards)
            .where(and(inArray(hazidHazards.id, set.hazardIds), isNull(hazidHazards.deletedAt)))
          // Preserve the set's authored order, which inArray does not.
          const order = new Map(set.hazardIds.map((id, index) => [id, index]))
          return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        })
      : Promise.resolve([]),
  ])

  // Every field the hazid template can reference, blank. Keys mirror the hazid
  // flow adapter so the same template renders a record or a blank sheet.
  return {
    reference: '',
    job_scope: '',
    location_on_site: '',
    locked: false,
    in_progress: true,
    status_label: '',
    occurred_at: '',
    locked_at: '',
    site_name: '',
    project_name: '',
    type_name: type?.name ?? '',
    show_job_scope: (type?.style ?? 'hazard_based') === 'hazard_based',
    show_ppe: type?.hasPPE ?? true,
    show_questions: type?.hasQuestions ?? true,
    show_tasks: (type?.style ?? 'hazard_based') === 'task_based',
    show_hazards: (type?.style ?? 'hazard_based') === 'hazard_based',
    show_risk_ratings: type?.hasRiskRatings ?? false,
    supervisor_name: '',
    reported_by_name: '',
    tasks: [],
    hazards: hazards.map((h) => ({
      name: h.name ?? '',
      standard_controls: h.standardControls ?? '',
      // The columns the crew writes into on site.
      specific_controls: '',
      controls: '',
      applicable: '',
      pre_likelihood: '',
      pre_severity: '',
      pre_risk: '',
      post_likelihood: '',
      post_severity: '',
      post_risk: '',
    })),
    ppe: ppe.map((p) => ({
      name: p.name ?? '',
      description: p.description ?? '',
      required: p.required ? 'Yes' : 'No',
      answer: '',
    })),
    questions: questions.map((q) => ({
      question: q.question ?? '',
      answer: '',
      requires_yes: q.requiresYes ? 'Yes' : '',
    })),
    signatures: [],
    photos: [],
  }
}
