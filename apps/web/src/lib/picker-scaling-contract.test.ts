import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function between(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start)
  const endIndex = content.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return content.slice(startIndex, endIndex)
}

describe('production-scale picker contract', () => {
  it('does not restart every remote lookup when translation hooks rerender', () => {
    const picker = source('../components/remote-search-select.tsx')
    const lookupEffect = between(picker, 'useEffect(() => {', 'const options = useMemo')

    expect(lookupEffect).not.toContain('setError(tGeneratedValue(')
    expect(lookupEffect).not.toMatch(/\[[^\]]*tGeneratedValue[^\]]*\]/)
    expect(picker).toContain('setError(false)')
    expect(picker).toContain('setError(true)')
    expect(picker).toContain('if (bounded === query) return')
  })

  it('keeps record-list filter options remote and scoped to visible records', () => {
    const route = source('../app/api/picker-options/route.ts')
    const inspections = between(
      route,
      "lookup === 'inspection-record-filter-types' ||",
      "lookup === 'journal-locations' ||",
    )
    expect(inspections).toContain("prefix: 'inspections'")
    expect(inspections).toContain('inspectionRecords.inspectorTenantUserId')
    expect(inspections).toContain('inspectionRecords.submittedByTenantUserId')
    expect(inspections).toContain('siteCol: inspectionRecords.siteOrgUnitId')
    expect(inspections.match(/\.limit\(PICKER_RESULT_LIMIT \+ 1\)/g)).toHaveLength(3)

    const workOrders = between(
      route,
      "lookup === 'equipment-work-order-filter-assignees' ||",
      "if (lookup === 'equipment-edit-types'",
    )
    expect(workOrders).toContain("prefix: 'equipment'")
    expect(workOrders).toContain('equipmentWorkOrders.openedByTenantUserId')
    expect(workOrders).toContain('equipmentWorkOrders.assignedToTenantUserId')
    expect(workOrders).toContain('siteCol: equipmentItems.currentSiteOrgUnitId')
    expect(workOrders).toContain('personCol: equipmentWorkOrders.reportedByPersonId')
    expect(workOrders.match(/\.limit\(PICKER_RESULT_LIMIT \+ 1\)/g)).toHaveLength(2)

    const inspectionPage = source('../app/(app)/inspections/records/page.tsx')
    expect(inspectionPage).toContain('lookup="inspection-record-filter-types"')
    expect(inspectionPage).toContain('lookup="inspection-record-filter-sites"')
    expect(inspectionPage).toContain('lookup="inspection-record-filter-inspectors"')
    expect(inspectionPage).not.toContain('.slice(0, 12)')

    const workOrderPage = source('../app/(app)/equipment/work-orders/page.tsx')
    expect(workOrderPage).toContain('lookup="equipment-work-order-filter-assignees"')
    expect(workOrderPage).toContain('lookup="equipment-work-order-filter-types"')
    expect(workOrderPage).not.toContain('.slice(0, 12)')
    expect(workOrderPage).not.toContain('.limit(20)')
    expect(workOrderPage).not.toContain('.limit(50)')
  })

  it('keeps edit catalogs remote while hydrating saved selections', () => {
    const equipmentPage = source('../app/(app)/equipment/[id]/page.tsx')
    expect(equipmentPage).toContain('lookup="equipment-edit-types"')
    expect(equipmentPage).toContain('lookup="equipment-edit-categories"')
    expect(equipmentPage).toContain('lookup="equipment-item-pre-use-inspection-types"')
    expect(equipmentPage).not.toContain('allTypes')
    expect(equipmentPage).not.toContain('allCategories')
    expect(equipmentPage).not.toContain('itemInspectionTypes')

    const maintenanceDrawers = source('../app/(app)/equipment/_maintenance-drawers.tsx')
    expect(maintenanceDrawers).toContain('lookup="equipment-item-inspection-types"')
    expect(maintenanceDrawers).toContain('initialOption={editing?.inspectionTypeOption}')

    const skillFields = source('../app/(app)/training/skills/[id]/_fields.tsx')
    expect(skillFields).toContain('lookup="training-skill-assignment-people"')
    expect(skillFields).toContain('lookup="training-skill-assignment-types"')
    expect(skillFields).toContain('initialOption={initialOptions.person}')
    expect(skillFields).toContain('initialOption={initialOptions.skillType}')

    const skillPage = source('../app/(app)/training/skills/[id]/page.tsx')
    expect(skillPage).not.toContain('peopleList')
    expect(skillPage).not.toContain('skillTypesList')

    const pickerRoute = source('../app/api/picker-options/route.ts')
    const injuryTypeBranch = between(
      pickerRoute,
      "if (lookup === 'incident-injury-types')",
      "if (lookup === 'management-review-documents'",
    )
    expect(injuryTypeBranch).toContain('eq(incidentInjuryTypes.isActive, 1)')
    expect(injuryTypeBranch).toContain('.limit(PICKER_RESULT_LIMIT + 1)')

    const injuryDrawer = source('../app/(app)/incidents/[id]/_people-injury-drawers.tsx')
    expect(injuryDrawer).toContain('lookup="incident-injury-types"')
    expect(injuryDrawer).not.toContain('injuryTypeOptions')
  })

  it('searches the full eligible class-attendee set without a hidden first-page cap', () => {
    const route = source('../app/api/picker-options/route.ts')
    const candidates = between(
      route,
      "if (lookup === 'training-class-attendee-candidates')",
      "lookup === 'training-assessment-people' ||",
    )
    expect(candidates).toContain('personMatch(input)')
    expect(route).toContain('ilike(primaryPersonTitleName(people.id, people.tenantId), input.term)')
    expect(candidates).toContain('ilike(people.email, input.term)')
    expect(candidates).toContain('notExists(')
    expect(candidates).toContain('.limit(PICKER_RESULT_LIMIT + 1)')

    const classPage = source('../app/(app)/training/classes/[id]/page.tsx')
    expect(classPage).toContain('<ClassAttendeePicker')
    expect(classPage).not.toContain('.limit(25)')
    expect(classPage).not.toContain('candidateQ')

    const picker = source('../app/(app)/training/classes/[id]/_attendee-picker.tsx')
    expect(picker).toContain('lookup="training-class-attendee-candidates"')
    expect(picker).toContain('contextId={classId}')
    expect(picker).toContain("placeholder={tGenerated('m_0cfc77616ec7e7')}")
  })

  it('uses the canonical primary title in every shared people picker', () => {
    const route = source('../app/api/picker-options/route.ts')
    const sharedPersonPicker = between(
      route,
      'const PERSON_OPTION_SELECTION',
      'function labelForFormKind',
    )

    expect(sharedPersonPicker).toContain(
      'jobTitle: primaryPersonTitleName(people.id, people.tenantId)',
    )
    expect(sharedPersonPicker).toContain(
      'ilike(primaryPersonTitleName(people.id, people.tenantId), input.term)',
    )
    expect(sharedPersonPicker).toContain('[row.employeeNo, row.jobTitle]')
    expect(route.match(/\.select\(PERSON_OPTION_SELECTION\)/g)).toHaveLength(8)
    expect(route.match(/personOptions\(rows\)/g)).toHaveLength(8)
  })

  it('keeps the public people kiosk PIN-gated, tenant-scoped, and bounded', () => {
    const actions = source('../app/kiosk/actions.ts')
    expect(actions).toContain('withVerifiedKioskScope')
    expect(actions).toContain("guardPublicPinRateLimit('people-kiosk', tenantId)")
    expect(actions).toContain('verifyKioskPin(tenant.kioskPin, pin)')
    expect(actions).toContain("set_config('app.tenant_id'")
    expect(actions.match(/\.limit\(PICKER_RESULT_LIMIT \+ 1\)/g)).toHaveLength(3)
    expect(actions).not.toContain('KioskDirectory')
    expect(actions).not.toContain('directory:')

    const client = source('../app/kiosk/kiosk-client.tsx')
    expect(client.match(/<RemoteSearchSelect/g)).toHaveLength(3)
    expect(client).toContain('loadOptions={peopleLoader}')
    expect(client).toContain('loadOptions={siteLoader}')
    expect(client).toContain('loadOptions={crewLoader}')
    expect(client).not.toContain('.slice(0, 50)')
  })

  it('searches complete hazard and journal facets inside exact record visibility', () => {
    const hazardActions = source('../app/(app)/hazard-assessments/_site-picker-actions.ts')
    expect(hazardActions).toContain("prefix: 'hazid'")
    expect(hazardActions).toContain('siteCol: hazidAssessments.siteOrgUnitId')
    expect(hazardActions).toContain('hazidAssessments.reportedByTenantUserId')
    expect(hazardActions).toContain('.limit(PICKER_RESULT_LIMIT + 1)')

    const hazardPage = source('../app/(app)/hazard-assessments/_list.tsx')
    expect(hazardPage).toContain('loadHazardAssessmentSiteOptions')
    expect(hazardPage).toContain('loadMyHazardAssessmentSiteOptions')
    expect(hazardPage).not.toContain('sites.slice(0, 12)')

    const journalActions = source('../app/(app)/journals/records/_tag-picker-actions.ts')
    expect(journalActions).toContain('journalCanBrowseAll(ctx)')
    expect(journalActions).toContain('journalScopeWhere(ctx, authorPersonId)')
    expect(journalActions.match(/\.limit\(PICKER_RESULT_LIMIT \+ 1\)/g)).toHaveLength(3)

    const journalPage = source('../app/(app)/journals/records/page.tsx')
    expect(journalPage).toContain('loadJournalRecordAuthorOptions')
    expect(journalPage).toContain('loadJournalRecordSiteOptions')
    expect(journalPage).toContain('loadJournalRecordTagOptions')
    expect(journalPage).not.toContain('tags.slice(0, 12)')
  })

  it('makes every Insights expression field discoverable without rendering a giant palette', () => {
    const palette = source('../app/(app)/insights/cards/_studio/expression-field.client.tsx')
    expect(palette).toContain('filterInsightsExpressionFields')
    expect(palette).toContain("placeholder={tGenerated('m_1908587deafbfa')}")
    expect(palette).toContain('<GeneratedText id="m_091e83de9853e7" />')
    expect(palette).not.toContain('fields.slice(0, 80)')
  })
})
