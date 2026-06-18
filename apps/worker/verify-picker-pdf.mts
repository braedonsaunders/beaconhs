// Throwaway verification: render a form PDF with picker fields and confirm
// resolved display names print instead of raw UUIDs. Run with root tsx.
import { writeFileSync } from 'node:fs'
import { renderFormPdf, closeBrowser } from '@beaconhs/forms-pdf'
import type { FormSchemaV1 } from '@beaconhs/forms-core'

const JOB_ID = '11111111-2222-3333-4444-555555555555'
const SITE_ID = '99999999-8888-7777-6666-555555555555'
const CUSTOMER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const EQUIP_ID = 'deadbeef-0000-0000-0000-000000000000' // intentionally no label → fallback
const ROW_SITE_ID = 'fefefefe-1111-1111-1111-111111111111' // repeating-row picker → fallback

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Lift Plan' },
  sections: [
    {
      id: 'main',
      title: { en: 'Job Details' },
      fields: [
        { id: 'jobNumber', type: 'project_picker', label: { en: 'Job Number' } },
        { id: 'site', type: 'site_picker', label: { en: 'Site' } },
        { id: 'customer', type: 'customer_picker', label: { en: 'Customer' } },
        { id: 'crane', type: 'equipment_picker', label: { en: 'Crane' } },
        { id: 'note', type: 'text', label: { en: 'Note' } },
      ],
    },
    {
      id: 'picks',
      title: { en: 'Repeating Picks' },
      repeating: true,
      fields: [{ id: 'rowSite', type: 'site_picker', label: { en: 'Row Site' } }],
    },
  ],
  workflow: {
    steps: [{ key: 'submit', title: { en: 'Submit' }, assignee: { type: 'role', role: 'worker' } }],
  },
} as unknown as FormSchemaV1

const pdf = await renderFormPdf({
  schema,
  values: {
    jobNumber: JOB_ID,
    site: SITE_ID,
    customer: CUSTOMER_ID,
    crane: EQUIP_ID,
    note: 'Tower crane erection',
    picks: [{ rowSite: ROW_SITE_ID }],
  },
  pickerLabelsByField: {
    jobNumber: 'Acme Tower Project',
    site: 'Downtown Yard',
    customer: 'Globex Corporation',
    // crane intentionally omitted → must fall back to raw id
  },
  metadata: { title: 'Lift Plan', tenantName: 'Test Co' },
})

writeFileSync('/tmp/picker-test.pdf', pdf)
console.log(`Wrote /tmp/picker-test.pdf (${pdf.length} bytes)`)
await closeBrowser()
