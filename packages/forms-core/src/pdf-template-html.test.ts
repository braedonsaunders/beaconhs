import { describe, expect, it } from 'vitest'
// devDependency — exercises the REAL compile + merge pipeline the generated
// template runs through in production (expand tr markers → renderTemplate).
import { expandRepeatMarkers, renderTemplate } from '@beaconhs/email-render'
import { validateFormSchema } from './schema'
import { generateFormPdfTemplate } from './pdf-template-html'

// A canonical schema exercising every generator branch: short + long fields,
// companions (_text/_image/_photos), signature, photo/file attachments, a
// table field, a repeating section, and layout-only fields (skipped).
const schema = validateFormSchema({
  schemaVersion: 1,
  title: { en: 'Crane Lift Plan' },
  workflow: {
    steps: [
      {
        key: 'submit',
        title: { en: 'Submit' },
        assignee: { type: 'expression', expr: 'submitter' },
      },
    ],
  },
  sections: [
    {
      id: 'general',
      title: { en: 'General' },
      fields: [
        { id: 'intro', type: 'heading', label: { en: 'Intro' } },
        { id: 'job_number', type: 'text', label: { en: 'Job number' } },
        { id: 'lift_date', type: 'datetime', label: { en: 'Lift date' } },
        { id: 'operator', type: 'person_picker', label: { en: 'Operator' } },
        { id: 'scope', type: 'long_text', label: { en: 'Scope of work' } },
        { id: 'narrative', type: 'rich_text', label: { en: 'Narrative' } },
        { id: 'signoff', type: 'signature', label: { en: 'Supervisor signature' } },
        { id: 'diagram', type: 'sketch', label: { en: 'Rigging diagram' } },
        { id: 'site_photos', type: 'photo', label: { en: 'Site photos' } },
        { id: 'attachments', type: 'file', label: { en: 'Attachments' } },
        {
          id: 'rigging',
          type: 'table',
          label: { en: 'Rigging gear' },
          config: {
            columns: [
              { key: 'item', label: 'Item', type: 'text' },
              { key: 'wll', label: 'WLL', type: 'text' },
            ],
          },
        },
      ],
    },
    {
      id: 'loads',
      title: { en: 'Loads' },
      repeating: true,
      fields: [
        { id: 'load_desc', type: 'text', label: { en: 'Load' } },
        { id: 'load_weight', type: 'number', label: { en: 'Weight (kg)' } },
        { id: 'load_photos', type: 'photo', label: { en: 'Load photos' } },
      ],
    },
  ],
})

describe('generateFormPdfTemplate', () => {
  const out = generateFormPdfTemplate(schema, 'Crane Lift Plan')

  it('produces a non-empty document with the app name and page footer', () => {
    expect(out.sourceHtml.length).toBeGreaterThan(500)
    expect(out.sourceHtml).toContain('Crane Lift Plan')
    expect(out.headerHtml).toBe('Crane Lift Plan')
    expect(out.footerHtml).toBe('Page {{page}} of {{pages}}')
  })

  it('references only loadValues() conventions per field type', () => {
    expect(out.sourceHtml).toContain('{{job_number}}')
    // datetime + picker get a readable _text companion
    expect(out.sourceHtml).toContain('{{lift_date_text}}')
    expect(out.sourceHtml).toContain('{{operator_text}}')
    // signature is projected to a signed URL; sketch exposes _image
    expect(out.sourceHtml).toContain('src="{{signoff}}"')
    expect(out.sourceHtml).toContain('src="{{diagram_image}}"')
    // rich text merges unescaped
    expect(out.sourceHtml).toContain('{{{narrative}}}')
    // photo/file/table/repeating-section collections via tr markers
    expect(out.sourceHtml).toContain('data-each="site_photos_photos"')
    expect(out.sourceHtml).toContain('{{site_photos_text}}')
    expect(out.sourceHtml).toContain('data-each="attachments"')
    expect(out.sourceHtml).toContain('data-each="rigging"')
    expect(out.sourceHtml).toContain('data-each="loads"')
    expect(out.sourceHtml).toContain('{{load_photos_text}}')
    expect(out.sourceHtml).toContain('data-each="loads_load_photos_photos"')
    // layout-only fields carry no tokens
    expect(out.sourceHtml).not.toContain('{{intro}}')
  })

  it('compiles through expandRepeatMarkers and merges real values', () => {
    const compiled = expandRepeatMarkers(out.sourceHtml)
    expect(compiled).not.toContain('data-each=')
    expect(compiled).not.toContain('data-if=')
    expect(compiled).toContain('{{#each loads}}')

    const html = renderTemplate(
      compiled,
      {
        compliance_status: 'compliant',
        compliance_score: 92,
        job_number: 'J-1042',
        lift_date_text: '2026-07-08 07:30',
        operator_text: 'Dana Fields',
        scope: 'Lift & set rooftop unit',
        narrative: '<p>All <strong>clear</strong></p>',
        signoff: 'data:image/png;base64,AAAA',
        diagram_image: 'https://files.test/sketch.png',
        site_photos: { attachments: [] },
        site_photos_text: '1 photo',
        site_photos_photos: [
          { url: 'https://files.test/1.jpg', filename: 'one.jpg', caption: 'Setup' },
        ],
        attachments: [{ url: 'https://files.test/a.pdf', filename: 'a.pdf' }],
        rigging: [{ item: 'Sling', wll: '2t' }],
        loads: [
          { load_desc: 'RTU', load_weight: 1800, load_photos_text: '1 photo' },
          { load_desc: 'Curb', load_weight: 240, load_photos_text: '0 photos' },
        ],
        loads_load_photos_photos: [
          {
            url: 'https://files.test/load.jpg',
            filename: 'load.jpg',
            caption: 'Rigged load',
          },
        ],
      },
      { escapeHtml: true },
    )
    expect(html).toContain('J-1042')
    expect(html).toContain('Dana Fields')
    // rich text survives; escaped fields do not inject markup
    expect(html).toContain('<strong>clear</strong>')
    expect(html).toContain('src="https://files.test/1.jpg"')
    expect(html).toContain('src="https://files.test/load.jpg"')
    // repeating rows expand with 1-based numbering
    expect(html).toContain('RTU')
    expect(html).toContain('Curb')
    expect(html).toContain('>1<')
    expect(html).toContain('>2<')
    // no unresolved block syntax remains
    expect(html).not.toContain('{{#each')
    expect(html).not.toContain('{{/each')
  })
})

describe('generated app PDFs survive a page break', () => {
  // Same contract the seeded module templates hold, and the same bug: a
  // repeating section that runs onto a second page used to re-derive its column
  // widths from only the rows on that page, and lost its column headings
  // entirely because a bare <tr> of <th> is parsed into <tbody>.
  const { sourceHtml } = generateFormPdfTemplate(schema, 'Crane Lift Plan')

  it('lays repeating tables out fixed so both halves match', () => {
    // Every table that repeats rows has to be fixed-layout.
    const repeatingTables = sourceHtml
      .split('<table')
      .filter((chunk) => chunk.includes('data-each='))
    expect(repeatingTables.length).toBeGreaterThan(0)
    for (const table of repeatingTables) {
      expect(table).toContain('table-layout:fixed')
    }
  })

  it('sizes the columns up front and repeats the headings', () => {
    expect(sourceHtml).toContain('<colgroup>')
    expect(sourceHtml).toContain('<thead>')
    // Headings belong in <thead>; a <th> outside one will not repeat on page
    // two. Strip the thead blocks and nothing header-ish may be left over.
    const withoutThead = sourceHtml.replace(/<thead>.*?<\/thead>/g, '')
    expect(withoutThead).not.toContain('<th ')
    expect((sourceHtml.match(/<thead>/g) ?? []).length).toBeGreaterThan(0)
  })

  it('gives every column an equal share that totals 100%', () => {
    const groups = sourceHtml.match(/<colgroup>.*?<\/colgroup>/g) ?? []
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      const widths = [...group.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]))
      expect(widths.length).toBeGreaterThan(0)
      expect(Math.abs(widths.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(0.5)
    }
  })
})
