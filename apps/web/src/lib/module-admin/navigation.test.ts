import { describe, expect, it } from 'vitest'
import { MODULE_ADMIN, moduleAdminByKey } from './registry'
import { groupModuleManagementSections, matchModuleManagementPath } from './navigation'

describe('module management navigation', () => {
  it('keeps nested editors in their section and selects the most specific library page', () => {
    expect(
      matchModuleManagementPath(MODULE_ADMIN, '/equipment/inspection-types/type-123'),
    ).toMatchObject({ module: { moduleKey: 'equipment' }, section: { key: 'inspection-types' } })
    expect(
      matchModuleManagementPath(MODULE_ADMIN, '/hazard-assessments/hazards/types/type-123'),
    ).toMatchObject({ module: { moduleKey: 'hazid' }, section: { key: 'hazard-types' } })
    expect(
      matchModuleManagementPath(MODULE_ADMIN, '/hazard-assessments/hazards/hazard-123'),
    ).toMatchObject({ section: { key: 'hazards' } })
  })

  it.each([
    '/equipment',
    '/equipment/maintenance',
    '/equipment/types-other',
    '/equipment/unit-123',
    '/equipment/inspections',
    '/training/classes/class-123',
    '/api/equipment/types',
  ])('leaves operational content outside the workspace: %s', (path) => {
    expect(matchModuleManagementPath(MODULE_ADMIN, path)).toBeUndefined()
  })

  it('groups scattered equipment automations together without moving pages between modules', () => {
    const groups = groupModuleManagementSections(moduleAdminByKey('equipment')!.sections)
    expect(groups.map((group) => group.label)).toEqual([
      'Assets',
      'Inspections',
      'Operations',
      'Printing',
      'Automations',
    ])
    expect(
      groups.find((group) => group.label === 'Automations')!.items.map((item) => item.label),
    ).toEqual(['Assets', 'Work orders', 'Inspections', 'Vehicle log'])
    expect(
      groups.find((group) => group.label === 'Operations')!.items.map((item) => item.key),
    ).toEqual(['station-settings', 'vehicle-log-settings'])
  })

  it('every management page has one unambiguous module and section, including guard-only subjects', () => {
    const paths = MODULE_ADMIN.flatMap((module) => module.sections.map((section) => section.href))
    expect(new Set(paths).size).toBe(paths.length)
    for (const config of MODULE_ADMIN) {
      expect(new Set(config.sections.map((section) => section.key)).size).toBe(
        config.sections.length,
      )
      for (const section of config.sections) {
        expect(section.group).toBeTruthy()
        expect(matchModuleManagementPath(MODULE_ADMIN, section.href)).toMatchObject({
          module: { moduleKey: config.moduleKey },
          section: { key: section.key },
        })
      }
    }
    expect(matchModuleManagementPath(MODULE_ADMIN, '/equipment/vehicle-log/flows')).toMatchObject({
      module: { moduleKey: 'equipment' },
      section: { key: 'vehicle-log-flows' },
    })
    expect(matchModuleManagementPath(MODULE_ADMIN, '/training/classes/flows')).toMatchObject({
      module: { moduleKey: 'training' },
      section: { key: 'class-flows' },
    })
  })
})
