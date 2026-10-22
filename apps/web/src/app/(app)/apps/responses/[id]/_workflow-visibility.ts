import type { FormWorkflowStep } from '@beaconhs/forms-core'

/** Capture pages assigned to the submitter are navigation, not pending approvals. */
export function showResponseWorkflow({
  steps,
  reviewSetting,
  hasRecordedSteps,
}: {
  steps: readonly FormWorkflowStep[]
  reviewSetting: boolean | undefined
  hasRecordedSteps: boolean
}): boolean {
  if (reviewSetting === false) return false
  return (
    reviewSetting === true ||
    hasRecordedSteps ||
    steps.some(
      (step) =>
        step.signatureRequired ||
        step.assignee.type !== 'expression' ||
        step.assignee.expr !== '$submitter',
    )
  )
}
