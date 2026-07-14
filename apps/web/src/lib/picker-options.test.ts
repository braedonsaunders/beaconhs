import { describe, expect, it } from 'vitest'
import {
  boundPickerOptions,
  isPickerLookup,
  isPickerOptionsResponse,
  PICKER_RESULT_LIMIT,
} from './picker-options'

describe('picker options contract', () => {
  it('accepts only exact purpose-scoped lookup names', () => {
    expect(isPickerLookup('vehicle-drivers')).toBe(true)
    expect(isPickerLookup('equipment-custody-sites')).toBe(true)
    expect(isPickerLookup('equipment-work-order-assignees')).toBe(true)
    expect(isPickerLookup('equipment-work-order-items')).toBe(true)
    expect(isPickerLookup('equipment-reminder-items')).toBe(true)
    expect(isPickerLookup('equipment-inspection-items')).toBe(true)
    expect(isPickerLookup('training-evaluation-people')).toBe(true)
    expect(isPickerLookup('training-class-instructors')).toBe(true)
    expect(isPickerLookup('training-class-attendee-candidates')).toBe(true)
    expect(isPickerLookup('training-skill-assignment-people')).toBe(true)
    expect(isPickerLookup('incident-injury-types')).toBe(true)
    expect(isPickerLookup('inspection-record-filter-inspectors')).toBe(true)
    expect(isPickerLookup('equipment-work-order-filter-types')).toBe(true)
    expect(isPickerLookup('equipment-item-inspection-types')).toBe(true)
    expect(isPickerLookup('training-course-classes')).toBe(true)
    expect(isPickerLookup('training-course-library-content')).toBe(true)
    expect(isPickerLookup('notification-group-people')).toBe(true)
    expect(isPickerLookup('compliance-obligation-form-templates')).toBe(true)
    expect(isPickerLookup('dashboard-quick-action-forms')).toBe(true)
    expect(isPickerLookup('admin-navigation-form-templates')).toBe(true)
    expect(isPickerLookup('people')).toBe(false)
    expect(isPickerLookup('toString')).toBe(false)
    expect(isPickerLookup('__proto__')).toBe(false)
    expect(isPickerLookup(null)).toBe(false)
  })

  it('returns at most the hard cap and advertises refinement only when needed', () => {
    const exact = Array.from({ length: PICKER_RESULT_LIMIT }, (_, index) => ({
      value: String(index),
      label: `Option ${index}`,
    }))
    expect(boundPickerOptions(exact)).toEqual({ options: exact, hasMore: false })

    const overflow = [...exact, { value: 'overflow', label: 'Overflow' }]
    expect(boundPickerOptions(overflow)).toEqual({ options: exact, hasMore: true })
  })

  it('rejects malformed or oversized client-boundary payloads', () => {
    expect(isPickerOptionsResponse({ options: [], hasMore: false })).toBe(true)
    expect(isPickerOptionsResponse({ options: [], hasMore: 'false' })).toBe(false)
    expect(isPickerOptionsResponse({ options: [{ value: 1, label: 'Bad' }], hasMore: false })).toBe(
      false,
    )
    expect(
      isPickerOptionsResponse({
        options: Array.from({ length: PICKER_RESULT_LIMIT + 1 }, (_, index) => ({
          value: String(index),
          label: String(index),
        })),
        hasMore: true,
      }),
    ).toBe(false)
    expect(
      isPickerOptionsResponse({
        options: [
          {
            value: 'daily-check',
            label: 'Daily check',
            meta: {
              kind: 'dashboard-quick-action',
              href: '/apps/by-key/daily-check/fill',
              iconKey: 'clipboard',
              tone: 'sky',
            },
          },
        ],
        hasMore: false,
      }),
    ).toBe(true)
    expect(
      isPickerOptionsResponse({
        options: [
          {
            value: '10000000-0000-4000-8000-000000000002',
            label: 'EQ-100 · Excavator',
            meta: {
              kind: 'equipment-inspection-item',
              typeId: '10000000-0000-4000-8000-000000000003',
            },
          },
        ],
        hasMore: false,
      }),
    ).toBe(true)
    expect(
      isPickerOptionsResponse({
        options: [
          {
            value: '10000000-0000-4000-8000-000000000001',
            label: 'Annual inspection',
            meta: {
              kind: 'equipment-inspection-type',
              intervalValue: 1,
              intervalUnit: 'year',
            },
          },
        ],
        hasMore: false,
      }),
    ).toBe(true)
    expect(
      isPickerOptionsResponse({
        options: [
          {
            value: '10000000-0000-4000-8000-000000000001',
            label: 'Bad interval',
            meta: {
              kind: 'equipment-inspection-type',
              intervalValue: 1.5,
              intervalUnit: 'fortnight',
            },
          },
        ],
        hasMore: false,
      }),
    ).toBe(false)
    expect(
      isPickerOptionsResponse({
        options: [
          {
            value: '10000000-0000-4000-8000-000000000001',
            label: 'Daily check',
            meta: {
              kind: 'admin-navigation-template',
              category: null,
              iconKey: null,
              status: 'draft',
            },
          },
        ],
        hasMore: false,
      }),
    ).toBe(true)
    expect(
      isPickerOptionsResponse({
        options: [
          {
            value: 'daily-check',
            label: 'Daily check',
            meta: { kind: 'dashboard-quick-action', href: 7, iconKey: 'clipboard', tone: 'sky' },
          },
        ],
        hasMore: false,
      }),
    ).toBe(false)
  })
})
