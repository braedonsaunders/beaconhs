import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { COMPONENT_SUBJECT_FIELDS } from './flows/component-subjects'
import { MODULE_FLOW_PROFILES } from './flows/module-profiles'

// CONTRACT TEST: a seeded PDF template, an entry in the "Module print defaults"
// picker, and a real /…/pdf route (or component composition target) are halves
// of one feature. Six modules once shipped a working template that never
// appeared in the picker because they had no route — the template was editable
// but unreachable from its record, so nobody could make a module print it.
//
// module-pdf.ts is `server-only`, so read the lists out of the source rather
// than importing its whole server dependency graph into a node test.

const APP_ROOT = resolve(import.meta.dirname, '../app/(app)')
const MODULE_PDF_SOURCE = readFileSync(resolve(import.meta.dirname, './module-pdf.ts'), 'utf8')

function parseTargetArray(declaration: string): { moduleKey: string; label: string }[] {
  const declared = MODULE_PDF_SOURCE.indexOf(declaration)
  expect(declared, `${declaration} not found in module-pdf.ts`).toBeGreaterThanOrEqual(0)
  // Skip the `{ … }[]` type annotation and read from the array literal itself.
  const start = MODULE_PDF_SOURCE.indexOf('= [', declared)
  const end = MODULE_PDF_SOURCE.indexOf('\n]', start)
  expect(end, `${declaration} array is not terminated`).toBeGreaterThan(start)
  const block = MODULE_PDF_SOURCE.slice(start, end)
  return [...block.matchAll(/\{\s*moduleKey:\s*'([^']+)',\s*label:\s*'([^']+)'\s*\}/g)].map(
    (m) => ({
      moduleKey: m[1]!,
      label: m[2]!,
    }),
  )
}

/** Where each target's record PDF route lives, relative to the (app) group. */
const ROUTES: Record<string, string> = {
  incidents: 'incidents/[id]/pdf/route.ts',
  hazid: 'hazard-assessments/[id]/pdf/route.ts',
  'corrective-actions': 'corrective-actions/[id]/pdf/route.ts',
  equipment: 'equipment/work-orders/[id]/pdf/route.ts',
  'equipment-assets': 'equipment/[id]/pdf/route.ts',
  'equipment-inspections': 'equipment/inspections/[id]/pdf/route.ts',
  ppe: 'ppe/inspections/[inspectionId]/pdf/route.ts',
  'ppe-issues': 'ppe/[id]/issues/[issueId]/pdf/route.ts',
  journals: 'journals/[id]/pdf/route.ts',
  inspections: 'inspections/records/[id]/pdf/route.ts',
  training: 'training/assessments/[id]/pdf/route.ts',
  'training-classes': 'training/classes/[id]/pdf/route.ts',
  'document-signoffs': 'documents/sign-off-sessions/[sessionId]/pdf/route.ts',
  documents: 'documents/management-reviews/[id]/pdf/route.ts',
  'vehicle-log': 'equipment/vehicle-log/pdf/route.ts',
}

describe('module PDF targets', () => {
  const targets = parseTargetArray('const MODULE_PDF_TARGETS')
  const componentTargets = parseTargetArray('const COMPONENT_PDF_TARGETS')
  const targetKeys = targets.map((t) => t.moduleKey)
  const componentKeys = componentTargets.map((t) => t.moduleKey)
  const allPickerKeys = [...targetKeys, ...componentKeys]

  it('parses the target lists', () => {
    expect(targetKeys.length).toBeGreaterThan(0)
    expect(componentKeys.length).toBeGreaterThan(0)
  })

  it('offers every module or component that ships a seeded template', () => {
    for (const seed of MODULE_PDF_TEMPLATE_SEEDS) {
      expect(
        allPickerKeys,
        `subject '${seed.subjectKey}' seeds a PDF template but is missing from the Module print defaults picker`,
      ).toContain(seed.subjectKey)
    }
  })

  it('only offers record modules that have a flow profile to render from', () => {
    for (const key of targetKeys) {
      expect(Object.keys(MODULE_FLOW_PROFILES), `no flow profile for target '${key}'`).toContain(
        key,
      )
    }
  })

  it('only offers component targets that declare merge fields', () => {
    for (const key of componentKeys) {
      expect(
        Object.keys(COMPONENT_SUBJECT_FIELDS),
        `no component subject fields for target '${key}'`,
      ).toContain(key)
    }
  })

  it('backs every record target with a real record PDF route', () => {
    for (const key of targetKeys) {
      const route = ROUTES[key]
      expect(route, `no route mapped for PDF target '${key}'`).toBeTruthy()
      expect(
        existsSync(resolve(APP_ROOT, route!)),
        `PDF target '${key}' points at a missing route: ${route}`,
      ).toBe(true)
    }
  })

  it('routes render the template chain, not a bespoke renderer', () => {
    for (const key of targetKeys) {
      const source = readFileSync(resolve(APP_ROOT, ROUTES[key]!), 'utf8')
      expect(source, `${key} route must go through renderModulePdfResponse`).toContain(
        'renderModulePdfResponse',
      )
      expect(source, `${key} route must name its module`).toContain(`'${key}'`)
    }
  })

  it('lists each subject once, with a label', () => {
    expect(new Set(allPickerKeys).size).toBe(allPickerKeys.length)
    for (const target of [...targets, ...componentTargets]) {
      expect(target.label.length).toBeGreaterThan(0)
    }
  })
})
