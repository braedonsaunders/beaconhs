import type { SelectOption } from '@beaconhs/ui'

/**
 * Purpose-specific lookup names. They are deliberately narrower than entity
 * names: each API branch has its own permission and visibility policy, so a
 * picker cannot become a generic tenant-directory escape hatch.
 */
export const PICKER_LOOKUPS = [
  'training-evaluation-people',
  'training-assessment-people',
  'training-assessment-types',
  'training-assessment-courses',
  'training-course-assessment-types',
  'training-course-classes',
  'training-course-library-content',
  'training-course-library-slides',
  'training-class-courses',
  'training-class-sites',
  'training-class-instructors',
  'training-class-attendee-candidates',
  'training-skill-assignment-people',
  'training-skill-assignment-types',
  'report-training-people',
  'report-training-departments',
  'report-training-groups',
  'report-training-courses',
  'journal-locations',
  'journal-supervisors',
  'safe-distance-sites',
  'safe-distance-supervisors',
  'safe-distance-operators',
  'compliance-by-person',
  'location-parent-units',
  'incident-sites',
  'incident-departments',
  'incident-classifications',
  'incident-people',
  'incident-injury-types',
  'inspection-sites',
  'inspection-people',
  'inspection-record-filter-types',
  'inspection-record-filter-sites',
  'inspection-record-filter-inspectors',
  'corrective-action-sites',
  'corrective-action-owners',
  'document-signoff-people',
  'document-signoff-sites',
  'management-review-members',
  'management-review-documents',
  'management-review-actions',
  'document-book-documents',
  'ppe-active-people',
  'ppe-types',
  'vehicle-equipment',
  'vehicle-customers',
  'vehicle-drivers',
  'equipment-custody-holders',
  'equipment-custody-sites',
  'equipment-station-holders',
  'equipment-station-locations',
  'equipment-reminder-assignees',
  'equipment-reminder-items',
  'equipment-inspection-items',
  'equipment-work-order-assignees',
  'equipment-work-order-reporters',
  'equipment-work-order-items',
  'equipment-types',
  'equipment-work-order-filter-assignees',
  'equipment-work-order-filter-types',
  'equipment-edit-types',
  'equipment-edit-categories',
  'equipment-item-inspection-types',
  'equipment-item-pre-use-inspection-types',
  'incident-classification-parents',
  'compliance-obligation-inspection-types',
  'compliance-obligation-documents',
  'compliance-obligation-courses',
  'compliance-obligation-assessment-types',
  'compliance-obligation-skill-types',
  'compliance-obligation-form-templates',
  'compliance-obligation-equipment-types',
  'compliance-obligation-ppe-types',
  'compliance-obligation-job-titles',
  'compliance-obligation-audience-roles',
  'compliance-obligation-audience-trades',
  'compliance-obligation-audience-departments',
  'compliance-obligation-audience-people',
  'compliance-obligation-audience-org-units',
  'dashboard-quick-action-forms',
  'admin-navigation-form-templates',
] as const

export type PickerLookup = (typeof PICKER_LOOKUPS)[number]

export type PickerOptionMeta =
  | {
      kind: 'dashboard-quick-action'
      href: string
      iconKey: string
      tone: string
    }
  | {
      kind: 'admin-navigation-template'
      category: string | null
      iconKey: string | null
      status: string
    }
  | {
      kind: 'equipment-inspection-item'
      typeId: string | null
    }
  | {
      kind: 'equipment-inspection-type'
      intervalValue: number | null
      intervalUnit: 'day' | 'week' | 'month' | 'year' | null
    }

export type PickerOption = SelectOption & {
  /** Purpose-specific presentation data; never interpreted by generic pickers. */
  meta?: PickerOptionMeta
}

export type PickerOptionsResponse = {
  options: PickerOption[]
  hasMore: boolean
}

export const PICKER_RESULT_LIMIT = 30

export function isPickerLookup(value: string | null): value is PickerLookup {
  return value !== null && (PICKER_LOOKUPS as readonly string[]).includes(value)
}

/** The sole response cap used by every picker query and the client validator. */
export function boundPickerOptions(options: SelectOption[]): PickerOptionsResponse {
  return {
    options: options.slice(0, PICKER_RESULT_LIMIT),
    hasMore: options.length > PICKER_RESULT_LIMIT,
  }
}

/** Runtime guard for the client boundary; do not trust even a same-origin fetch blindly. */
export function isPickerOptionsResponse(value: unknown): value is PickerOptionsResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PickerOptionsResponse>
  return (
    typeof candidate.hasMore === 'boolean' &&
    Array.isArray(candidate.options) &&
    candidate.options.length <= PICKER_RESULT_LIMIT &&
    candidate.options.every((option) => {
      if (
        !option ||
        typeof option !== 'object' ||
        typeof option.value !== 'string' ||
        typeof option.label !== 'string' ||
        (option.hint !== undefined && typeof option.hint !== 'string')
      ) {
        return false
      }
      if (option.meta === undefined) return true
      if (option.meta.kind === 'dashboard-quick-action') {
        return (
          typeof option.meta.href === 'string' &&
          typeof option.meta.iconKey === 'string' &&
          typeof option.meta.tone === 'string'
        )
      }
      if (option.meta.kind === 'equipment-inspection-type') {
        return (
          (option.meta.intervalValue === null ||
            (Number.isSafeInteger(option.meta.intervalValue) && option.meta.intervalValue > 0)) &&
          (option.meta.intervalUnit === null ||
            ['day', 'week', 'month', 'year'].includes(option.meta.intervalUnit))
        )
      }
      if (option.meta.kind === 'equipment-inspection-item') {
        return option.meta.typeId === null || typeof option.meta.typeId === 'string'
      }
      return (
        option.meta.kind === 'admin-navigation-template' &&
        (option.meta.category === null || typeof option.meta.category === 'string') &&
        (option.meta.iconKey === null || typeof option.meta.iconKey === 'string') &&
        typeof option.meta.status === 'string'
      )
    })
  )
}
