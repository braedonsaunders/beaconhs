import { describe, expect, it } from 'vitest'
import { WIDGETS } from './_widget-registry'
import {
  canPermissionSetPublishInsights,
  canPermissionSetViewInsights,
  canSeeOrgAggregates,
  canSeeWidget,
} from './_widget-access'

function context(permissions: string[], isSuperAdmin = false) {
  return {
    isSuperAdmin,
    permissions: new Set(permissions),
  } as Parameters<typeof canSeeWidget>[0]
}

describe('dashboard widget access', () => {
  const worker = context([
    'incidents.read.self',
    'ca.read.self',
    'journals.read.self',
    'forms.response.read.self',
    'inspections.read.self',
    'hazid.read.self',
    'training.read.self',
    'documents.read',
  ])
  const manager = context([
    'incidents.read.all',
    'ca.read.all',
    'training.read.all',
    'ppe.read.all',
    'forms.response.read.all',
    'inspections.read.all',
    'documents.manage',
    'admin.org.manage',
    'reports.read',
    'insights.read',
  ])

  it('limits self-tier users to personal widgets', () => {
    for (const id of Object.keys(WIDGETS)) {
      expect(canSeeWidget(worker, id), id).toBe(id.startsWith('personal-'))
    }
    expect(canSeeOrgAggregates(worker)).toBe(false)
  })

  it('allows managers to see registry and Insights widgets', () => {
    for (const id of Object.keys(WIDGETS)) {
      expect(canSeeWidget(manager, id), id).toBe(true)
    }
    expect(canSeeWidget(manager, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true)
    expect(canSeeOrgAggregates(manager)).toBe(true)
  })

  it('allows super-admins to see every widget', () => {
    const superAdmin = context([], true)
    expect(canSeeWidget(superAdmin, 'kpi-open-cas')).toBe(true)
    expect(canSeeWidget(superAdmin, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true)
  })

  it('does not treat report or dashboard permissions as Insights access', () => {
    expect(canPermissionSetViewInsights(['reports.read'])).toBe(false)
    expect(canPermissionSetViewInsights(['dashboards.read'])).toBe(false)
    expect(canPermissionSetViewInsights(['insights.read'])).toBe(true)
    expect(canPermissionSetPublishInsights(['reports.builder'])).toBe(false)
    expect(canPermissionSetPublishInsights(['insights.publish'])).toBe(true)
  })
})
