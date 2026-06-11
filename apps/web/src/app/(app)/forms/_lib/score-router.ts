// Score-based routing for form responses.
//
// Called from the submit-side server action AND from the response viewer
// (so the viewer can render a "Failed checks" section even for older
// responses persisted before the compliance columns were populated).
//
// Inputs:
//   schema  — template version's FormSchemaV1
//   values  — top-level response.data (keyed by field id)
//   rows    — repeating-section row arrays, hoisted out of response.data so
//             the formula evaluator's section-aware operators work
//
// Outputs:
//   score             — 0..100 numeric verdict
//   failedFieldKeys   — field ids whose response value contributed to a fail
//   status            — 'compliant' | 'non_compliant' | 'pending_review'
//
// Default behaviour when scoreRouting is absent on the template:
//   * Scan pass_fail_na fields (and yes_no_comment, for symmetry).
//   * score = (pass_count) / (pass + fail count) × 100, ignoring N/A.
//   * status = 'non_compliant' if any fail, otherwise 'compliant'.
//
// When scoreRouting.scoreFormula is present we run it through
// `evaluateFormulaTree`; the failed-field list is still derived from the
// pass_fail_na scan because the formula tree by itself doesn't surface which
// fields tipped the verdict.

import {
  evaluateFormulaTree,
  isScoringField,
  type EvalContext,
  type FormSchemaV1,
  type FormulaExpression,
  type HardFailRule,
} from '@beaconhs/forms-core'

export type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending_review'

export type ComputeFormScoreResult = {
  score: number
  failedFieldKeys: string[]
  status: ComplianceStatus
}

// --- Default score derivation ----------------------------------------------

function deriveDefaultScore(
  schema: FormSchemaV1,
  values: Record<string, unknown>,
): { score: number; failedFieldKeys: string[]; hasAnyScorable: boolean } {
  let pass = 0
  let fail = 0
  const failedFieldKeys: string[] = []
  let hasAnyScorable = false

  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (!isScoringField(field.type)) continue
      // Only pass/fail-shaped types contribute to default scoring; rating /
      // traffic_light / risk_matrix don't have a binary pass-fail axis.
      if (field.type !== 'pass_fail_na' && field.type !== 'yes_no_comment') continue
      hasAnyScorable = true

      let answer: string | null = null
      const raw = values[field.id]
      if (field.type === 'pass_fail_na') {
        answer = raw == null ? null : String(raw)
      } else {
        // yes_no_comment stores `{ answer: 'yes' | 'no' | 'na', comment?: string }`
        const v = raw as { answer?: string } | undefined
        answer = v?.answer ?? null
      }

      if (answer === 'pass' || answer === 'yes') pass += 1
      else if (answer === 'fail' || answer === 'no') {
        fail += 1
        failedFieldKeys.push(field.id)
      }
      // N/A or missing — skip
    }
  }

  const denom = pass + fail
  const score = denom > 0 ? Math.round((pass / denom) * 10000) / 100 : 100
  return { score, failedFieldKeys, hasAnyScorable: hasAnyScorable && denom > 0 }
}

// --- Hard-fail rule evaluation ---------------------------------------------

function evaluateHardFailRules(rules: HardFailRule[], values: Record<string, unknown>): string[] {
  const trigger: string[] = []
  for (const rule of rules) {
    for (const key of rule.fieldKeys) {
      const raw = values[key]
      if (raw === undefined || raw === null) continue
      const s =
        typeof raw === 'string'
          ? raw
          : typeof raw === 'object' && raw && 'answer' in raw
            ? String((raw as { answer?: string }).answer ?? '')
            : String(raw)
      if (rule.kind === 'any_field_eq' && s === rule.value) trigger.push(key)
      if (rule.kind === 'any_field_in' && rule.values.includes(s)) trigger.push(key)
    }
  }
  return trigger
}

// --- Entry point -----------------------------------------------------------

export function computeFormScore(
  schema: FormSchemaV1,
  values: Record<string, unknown>,
  rows: Record<string, Array<Record<string, unknown>>>,
): ComputeFormScoreResult {
  const routing = schema.workflow?.scoreRouting
  const evalCtx: EvalContext = { values, rows }

  // 1. Resolve the numeric score.
  let score: number
  const defaultDerivation = deriveDefaultScore(schema, values)
  if (routing?.scoreFormula) {
    const raw = evaluateFormulaTree(routing.scoreFormula as FormulaExpression, evalCtx)
    const n = Number(raw)
    score = Number.isFinite(n) ? n : 0
  } else {
    score = defaultDerivation.score
  }

  // 2. Collect failed field keys. We always run the default scan so the UI
  //    has a list of items to surface, even when a custom formula produced
  //    the headline number.
  const failedFieldKeys = [...defaultDerivation.failedFieldKeys]
  if (routing?.hardFailRules) {
    const hardFailKeys = evaluateHardFailRules(routing.hardFailRules, values)
    for (const k of hardFailKeys) {
      if (!failedFieldKeys.includes(k)) failedFieldKeys.push(k)
    }
  }

  // 3. Compute status.
  //    - If there's no scoring at all on the template AND no routing rules,
  //      treat as pending_review (someone has to look at it manually).
  //    - Hard-fail rule trigger always wins → non_compliant.
  //    - Otherwise threshold check.
  let status: ComplianceStatus = 'compliant'

  const hardFailTriggered =
    !!routing?.hardFailRules && evaluateHardFailRules(routing.hardFailRules, values).length > 0

  if (hardFailTriggered) {
    status = 'non_compliant'
  } else if (routing?.thresholdScore !== undefined) {
    status = score < routing.thresholdScore ? 'non_compliant' : 'compliant'
  } else if (defaultDerivation.hasAnyScorable) {
    // Default rule: any fail → non_compliant.
    status = failedFieldKeys.length > 0 ? 'non_compliant' : 'compliant'
  } else {
    // Template has no scoring fields and no explicit routing — caller decides.
    // We return 'pending_review' so the viewer can still display a neutral pill.
    status = 'pending_review'
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    failedFieldKeys,
    status,
  }
}

// --- Severity helper ------------------------------------------------------

// Used by the spawn-CAPA drawer to pick a default severity based on how badly
// the response missed its threshold. Caller can override.
export function severityFromScore(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'low'
  if (score >= 60) return 'medium'
  if (score >= 40) return 'high'
  return 'critical'
}
