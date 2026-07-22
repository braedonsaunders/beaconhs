import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../../../lib/effective-roles', () => ({
  getEffectiveRoleKeys: async () => new Set<string>(),
}))
vi.mock('../../(app)/apps/_lib/access', () => ({
  templateAccessWhere: () => undefined,
}))

const state = vi.hoisted(() => ({
  context: null as null | {
    isSuperAdmin: boolean
    permissions: Set<string>
    db: ReturnType<typeof vi.fn>
  },
  authCalls: 0,
}))

vi.mock('../../../lib/auth', () => ({
  getRequestContext: async () => {
    state.authCalls++
    return state.context
  },
}))

import { GET } from './route'

function request(query: string) {
  return GET(new Request(`http://localhost/api/picker-options?${query}`))
}

describe('picker options route policy', () => {
  beforeEach(() => {
    state.context = null
    state.authCalls = 0
  })

  it('rejects unknown lookup capabilities before authentication or database work', async () => {
    const response = await request('lookup=people')
    expect(response.status).toBe(400)
    expect(state.authCalls).toBe(0)
  })

  it('requires a valid parent context for course evaluation candidates', async () => {
    const response = await request('lookup=training-evaluation-people&contextId=not-a-uuid')
    expect(response.status).toBe(400)
    expect(state.authCalls).toBe(0)
  })

  it('requires a valid course context for course-class candidates', async () => {
    const response = await request('lookup=training-course-classes&contextId=not-a-uuid')
    expect(response.status).toBe(400)
    expect(state.authCalls).toBe(0)
  })

  it('requires a valid class context for attendee candidates', async () => {
    const response = await request('lookup=training-class-attendee-candidates&contextId=bad')
    expect(response.status).toBe(400)
    expect(state.authCalls).toBe(0)
  })

  it('rejects malformed optional context identifiers before authentication', async () => {
    const response = await request('lookup=equipment-item-inspection-types&contextId=bad')
    expect(response.status).toBe(400)
    expect(state.authCalls).toBe(0)
  })

  it('requires an authenticated active-tenant context', async () => {
    const response = await request('lookup=vehicle-drivers')
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('checks the lookup-specific permission before invoking ctx.db', async () => {
    const db = vi.fn()
    state.context = { isSuperAdmin: false, permissions: new Set(), db }
    const response = await request('lookup=vehicle-drivers')
    expect(response.status).toBe(403)
    expect(db).not.toHaveBeenCalled()
  })

  it.each([
    ['lookup=training-assessment-people', 'training.read.self'],
    ['lookup=training-course-assessment-types', 'training.course.manage'],
    [
      'lookup=training-course-classes&contextId=10000000-0000-4000-8000-000000000001',
      'training.course.manage',
    ],
    ['lookup=training-course-library-content', 'training.course.manage'],
    ['lookup=training-class-courses', 'training.class.manage'],
    ['lookup=training-class-sites', 'training.class.manage'],
    ['lookup=training-class-instructors', 'training.class.manage'],
    [
      'lookup=training-class-attendee-candidates&contextId=10000000-0000-4000-8000-000000000001',
      'training.class.manage',
    ],
    ['lookup=training-skill-assignment-people', 'training.course.manage'],
    ['lookup=training-skill-assignment-types', 'training.course.manage'],
    ['lookup=report-people', 'reports.read'],
    ['lookup=report-course-types', 'reports.read'],
    ['lookup=report-obligations', 'reports.read'],
    ['lookup=report-skill-types', 'reports.read'],
    ['lookup=report-skill-authorities', 'reports.read'],
    ['lookup=report-sites', 'reports.read'],
    ['lookup=report-ppe-types', 'reports.read'],
    ['lookup=journal-supervisors', 'journals.update.own'],
    ['lookup=safe-distance-operators', 'tools.safe-distance.use'],
    ['lookup=compliance-by-person', 'compliance.read'],
    ['lookup=location-parent-units', 'admin.org.manage'],
    ['lookup=incident-people', 'incidents.investigate'],
    ['lookup=inspection-people', 'inspections.update'],
    ['lookup=inspection-record-filter-types', 'inspections.read.self'],
    ['lookup=inspection-record-filter-sites', 'inspections.read.site'],
    ['lookup=inspection-record-filter-inspectors', 'inspections.read.all'],
    ['lookup=corrective-action-owners', 'ca.update'],
    ['lookup=document-signoff-people', 'documents.manage'],
    ['lookup=ppe-active-people', 'ppe.issue'],
    ['lookup=vehicle-customers', 'equipment.manage'],
    ['lookup=equipment-custody-holders', 'equipment.manage'],
    ['lookup=equipment-custody-sites', 'equipment.manage'],
    ['lookup=equipment-station-holders', 'equipment.manage'],
    ['lookup=equipment-station-locations', 'equipment.manage'],
    ['lookup=equipment-reminder-assignees', 'equipment.manage'],
    ['lookup=equipment-reminder-items', 'equipment.manage'],
    ['lookup=equipment-inspection-items', 'equipment.inspect'],
    ['lookup=equipment-work-order-assignees', 'equipment.workorder.create'],
    ['lookup=equipment-work-order-reporters', 'equipment.workorder.create'],
    ['lookup=equipment-work-order-assignees', 'equipment.workorder.close'],
    ['lookup=equipment-work-order-reporters', 'equipment.workorder.close'],
    ['lookup=equipment-work-order-items', 'equipment.workorder.create'],
    ['lookup=equipment-types', 'equipment.read.all'],
    ['lookup=equipment-work-order-filter-assignees', 'equipment.read.site'],
    ['lookup=equipment-work-order-filter-types', 'equipment.workorder.create'],
    ['lookup=equipment-edit-types', 'equipment.manage'],
    ['lookup=equipment-edit-categories', 'equipment.manage'],
    ['lookup=equipment-item-inspection-types', 'equipment.manage'],
    ['lookup=equipment-item-inspection-types', 'equipment.inspect'],
    ['lookup=equipment-item-pre-use-inspection-types', 'equipment.manage'],
    ['lookup=incident-classification-parents', 'incidents.read.all'],
    ['lookup=compliance-obligation-documents', 'compliance.assign'],
    ['lookup=compliance-obligation-audience-people', 'compliance.manage'],
    ['lookup=dashboard-quick-action-forms', 'forms.response.create'],
    ['lookup=admin-navigation-form-templates', 'admin.nav.manage'],
  ])('accepts the canonical permission for %s', async (query, permission) => {
    const db = vi.fn().mockRejectedValue(new Error('query sentinel'))
    state.context = { isSuperAdmin: false, permissions: new Set([permission]), db }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await request(query)
    consoleError.mockRestore()
    expect(response.status).toBe(500)
    expect(db).toHaveBeenCalledOnce()
  })
})
