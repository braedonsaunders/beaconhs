import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { collectResponseEntityReferences } from './response-entity-references'

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'References' },
  workflow: {
    steps: [{ key: 'fill', title: { en: 'Fill' }, assignee: { type: 'role', role: 'worker' } }],
  },
  sections: [
    {
      id: 'main',
      title: { en: 'Main' },
      fields: [
        { id: 'person', type: 'person_picker', label: { en: 'Person' } },
        { id: 'people', type: 'multi_person_picker', label: { en: 'People' } },
        { id: 'site', type: 'site_picker', label: { en: 'Site' } },
      ],
    },
    {
      id: 'rows',
      title: { en: 'Rows' },
      repeating: true,
      fields: [{ id: 'project', type: 'project_picker', label: { en: 'Project' } }],
    },
  ],
}

describe('collectResponseEntityReferences', () => {
  it('collects scalar, multi-person, org-level, and repeating references with error paths', () => {
    expect(
      collectResponseEntityReferences(schema, {
        person: 'person-1',
        people: ['person-2', 'person-3'],
        site: 'site-1',
        rows: [{ project: 'project-1' }, { project: 'project-2' }],
      }),
    ).toEqual([
      { fieldId: 'person', id: 'person-1', kind: 'person' },
      { fieldId: 'people', id: 'person-2', kind: 'person' },
      { fieldId: 'people', id: 'person-3', kind: 'person' },
      { fieldId: 'site', id: 'site-1', kind: 'org_unit', level: 'site' },
      { fieldId: 'rows.0.project', id: 'project-1', kind: 'org_unit', level: 'project' },
      { fieldId: 'rows.1.project', id: 'project-2', kind: 'org_unit', level: 'project' },
    ])
  })
})
