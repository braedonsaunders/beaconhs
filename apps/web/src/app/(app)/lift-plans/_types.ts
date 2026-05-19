// Shared data shapes used by both server-rendered detail page tabs and
// client-side widgets (signature pad, load editor, equipment picker). Kept
// in one file so server / client boundaries don't need to re-declare them.

export type LiftPlanStatus =
  | 'draft'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export type LiftPlanSignatureRole =
  | 'supervisor'
  | 'operator'
  | 'rigger'
  | 'signaler'
  | 'spotter'

export const LIFT_PLAN_STATUSES: LiftPlanStatus[] = [
  'draft',
  'approved',
  'in_progress',
  'completed',
  'cancelled',
]

export const LIFT_PLAN_SIGNATURE_ROLES: LiftPlanSignatureRole[] = [
  'supervisor',
  'operator',
  'rigger',
  'signaler',
  'spotter',
]

export type PersonForPicker = {
  id: string
  firstName: string
  lastName: string
}

export type TenantUserForPicker = {
  id: string
  displayName: string | null
}

export type OrgUnitForPicker = {
  id: string
  name: string
}

export type EquipmentItemForPicker = {
  id: string
  name: string
  assetTag: string
}

export function formatStatus(status: LiftPlanStatus): string {
  return status.replace(/_/g, ' ')
}

export function formatRole(role: LiftPlanSignatureRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
