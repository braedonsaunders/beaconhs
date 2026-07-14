export type InspectionRecordLifecycleStatus = 'draft' | 'in_progress' | 'submitted' | 'closed'

export type InspectionRecordLifecycleState = {
  status: InspectionRecordLifecycleStatus
  locked: boolean
  submittedAt: Date | null
  submittedByTenantUserId: string | null
  closedAt: Date | null
  closedByTenantUserId: string | null
}

type InspectionRecordLifecyclePatch = Pick<
  InspectionRecordLifecycleState,
  | 'status'
  | 'locked'
  | 'submittedAt'
  | 'submittedByTenantUserId'
  | 'closedAt'
  | 'closedByTenantUserId'
>

/**
 * Produce the complete milestone patch for one serialized status transition.
 * Closing preserves the original submission attribution; returning to an
 * editable state clears every later milestone and unlocks the record.
 */
export function inspectionStatusMilestonePatch(
  record: InspectionRecordLifecycleState,
  nextStatus: InspectionRecordLifecycleStatus,
  actorTenantUserId: string | null,
  now: Date,
): Partial<InspectionRecordLifecyclePatch> {
  if (record.status === nextStatus) return {}
  const submitting = nextStatus === 'submitted' || nextStatus === 'closed'
  const closing = nextStatus === 'closed'
  return {
    status: nextStatus,
    submittedAt: submitting ? (record.submittedAt ?? now) : null,
    submittedByTenantUserId: submitting
      ? (record.submittedByTenantUserId ?? actorTenantUserId)
      : null,
    closedAt: closing ? now : null,
    closedByTenantUserId: closing ? actorTenantUserId : null,
    locked: closing,
  }
}
