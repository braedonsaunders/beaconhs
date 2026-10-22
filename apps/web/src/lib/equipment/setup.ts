import { resolveEnabledFieldGroups } from './field-groups'
import type { ServicePlanInput } from './service-plans'
export type EquipmentSetupInput = {
  requestId: string
  categoryId: string
  typeId: string
  newTypeName: string
  name: string
  assetTag: string
  sections: Record<string, { unavailable: boolean; reason: string }>
  fields: Record<string, string>
  custom: Record<string, string>
  identifyingDetailsUnavailable: boolean
  identifyingDetailsReason: string
  preUseRequired: boolean | null
  preUseTypeId: string
  scheduledInspectionsRequired: boolean | null
  inspectionSchedules: Array<{
    typeId: string
    every: number
    unit: 'day' | 'week' | 'month' | 'year'
    dueOn: string
  }>
  noInspectionsReason: string
  maintenanceRequired: boolean | null
  maintenance: ServicePlanInput[]
  noMaintenanceReason: string
  reviewed: boolean
}
export function emptyEquipmentSetup(requestId: string): EquipmentSetupInput {
  return {
    requestId,
    categoryId: '',
    typeId: '',
    newTypeName: '',
    name: '',
    assetTag: '',
    sections: {},
    fields: { ownership: 'owned' },
    custom: {},
    identifyingDetailsUnavailable: false,
    identifyingDetailsReason: '',
    preUseRequired: null,
    preUseTypeId: '',
    scheduledInspectionsRequired: null,
    inspectionSchedules: [],
    noInspectionsReason: '',
    maintenanceRequired: null,
    maintenance: [],
    noMaintenanceReason: '',
    reviewed: false,
  }
}
export function equipmentSetupStepError(value: EquipmentSetupInput, step: number): string | null {
  if (step === 0 && !value.categoryId) return 'Choose an equipment category.'
  if (step === 1) {
    if (!value.typeId && !value.newTypeName.trim())
      return 'Choose an equipment type or enter a new type.'
    if (!value.name.trim() || !value.assetTag.trim())
      return 'Enter the equipment name and asset tag.'
    if (
      !value.fields.serialNumber?.trim() &&
      !value.fields.vin?.trim() &&
      !value.fields.licensePlate?.trim() &&
      (!value.identifyingDetailsUnavailable || value.identifyingDetailsReason.trim().length < 5)
    )
      return 'Enter a serial number, VIN, or plate, or explain why these details are unavailable.'
  }
  if (step === 2) {
    if (
      typeof value.preUseRequired !== 'boolean' ||
      typeof value.scheduledInspectionsRequired !== 'boolean'
    )
      return 'Answer both inspection questions.'
    if (value.preUseRequired && !value.preUseTypeId)
      return 'Choose the pre-use inspection checklist.'
    if (
      value.scheduledInspectionsRequired &&
      (!value.inspectionSchedules.length ||
        value.inspectionSchedules.some((s) => !s.typeId || !s.dueOn || !s.every))
    )
      return 'Add the scheduled inspection, checklist, interval, and first due date.'
    if (
      !value.preUseRequired &&
      !value.scheduledInspectionsRequired &&
      value.noInspectionsReason.trim().length < 5
    )
      return 'Explain why this equipment does not need inspections.'
  }
  if (step === 3) {
    if (typeof value.maintenanceRequired !== 'boolean')
      return 'Choose whether this equipment needs periodic maintenance.'
    if (value.maintenanceRequired && !value.maintenance.length)
      return 'Add at least one maintenance task.'
    if (!value.maintenanceRequired && value.noMaintenanceReason.trim().length < 5)
      return 'Explain why this equipment does not need periodic maintenance.'
    const error = equipmentSetupMaintenanceError(value)
    if (error) return error
  }
  if (step === 4 && value.reviewed !== true)
    return 'Review and confirm the equipment setup before creating it.'
  return null
}

export function equipmentSetupSectionsError(
  value: EquipmentSetupInput,
  enabledKeys: string[] | null | undefined,
): string | null {
  for (const group of resolveEnabledFieldGroups(enabledKeys)) {
    const acknowledgement = value.sections?.[group.key]
    if (acknowledgement?.unavailable) {
      if (acknowledgement.reason.trim().length < 5)
        return 'Explain why these details are unavailable.'
      continue
    }
    const essential =
      group.key === 'manufacture'
        ? ['manufacturer', 'model']
        : group.key === 'vehicle'
          ? ['vin', 'licensePlate']
          : null
    const complete = essential
      ? essential.every((key) => value.fields[key]?.trim())
      : group.fields.some((field) => value.fields[field.field]?.trim())
    if (!complete)
      return 'Complete this category-enabled section, or explain why its details are unavailable.'
  }
  return null
}

function equipmentSetupMaintenanceError(value: EquipmentSetupInput): string | null {
  if (!value.maintenanceRequired) return null
  const customMeters = value.maintenance.flatMap((p) => p.meters ?? [])
  for (const plan of value.maintenance)
    if (plan.isActive)
      for (const rule of plan.rules) {
        if (rule.kind === 'calendar' && (rule.every === null || rule.dueOn === null))
          return 'Enter the interval and first due date for active maintenance. Pause the task if setup is not yet known.'
        if (rule.kind === 'meter') {
          if (rule.dueAt === null) return 'Enter a next due reading for active maintenance.'
          if (rule.meter === 'engine_hours' || rule.meter === 'odometer') {
            const field = rule.meter === 'engine_hours' ? 'currentHours' : 'currentOdometer'
            if (!value.fields[field]?.trim())
              return 'Enter the current equipment reading for each active usage condition.'
          } else if (customMeters.find((m) => m.id === rule.meter)?.value == null)
            return 'Enter the initial reading for each active custom counter.'
        }
      }
  return null
}
