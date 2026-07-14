import { describe, expect, it } from 'vitest'
import type { FormField, FormSchemaV1 } from './schema'
import { validateFieldValue, validateResponse } from './validator'

const ATTACHMENT_ID = '10000000-0000-4000-8000-000000000001'
const ATTACHMENT_URL = `/api/attachments/${ATTACHMENT_ID}?cap=${'A'.repeat(43)}`
const ATTACHMENT = {
  attachmentId: ATTACHMENT_ID,
  filename: 'jobsite.jpg',
  contentType: 'image/jpeg',
  url: ATTACHMENT_URL,
}
const SAFETY_ANALYSIS = {
  summary: 'Workers are wearing required PPE.',
  overallRisk: 'low',
  ppe: [{ item: 'hard hat', status: 'present', detail: null }],
  hazards: [{ type: 'housekeeping', severity: 'low', detail: 'Loose packaging.' }],
}

function field(id: string, type: FormField['type'], extra: Partial<FormField> = {}): FormField {
  const defaultConfig =
    type === 'matrix'
      ? {
          rows: [{ key: 'row', label: 'Row' }],
          scale: [
            { value: '1', label: 'Low' },
            { value: '2', label: 'High' },
          ],
        }
      : undefined
  return { id, type, label: { en: id }, config: defaultConfig, ...extra }
}

function schemaWith(fields: FormField[], repeating = false): FormSchemaV1 {
  return {
    schemaVersion: 1,
    title: { en: 'Validation test' },
    sections: [{ id: 'section', repeating, fields }],
    workflow: {
      steps: [
        {
          key: 'submit',
          title: { en: 'Submit' },
          assignee: { type: 'role', role: 'worker' },
        },
      ],
    },
  }
}

describe('validateFieldValue', () => {
  it('uses visible rich-text content for required and length checks', () => {
    const required = field('notes', 'rich_text', {
      required: true,
      validation: { minLength: 5, maxLength: 10 },
    })

    expect(validateFieldValue(required, '<p><br></p><img src="ignored.png">')).toBe('Required')
    expect(validateFieldValue(required, '<p>Four</p>')).toBe('Min 5 chars')
    expect(validateFieldValue(required, '<p>Exactly 10</p>')).toBeNull()
    expect(validateFieldValue(required, '<p>More than ten</p>')).toBe('Max 10 chars')
  })

  it('validates compound completion and slider configuration consistently', () => {
    expect(validateFieldValue(field('address', 'address', { required: true }), {})).toBe('Required')
    expect(
      validateFieldValue(field('address', 'address', { required: true }), {
        query: '100 Safety Way',
      }),
    ).toBeNull()
    expect(validateFieldValue(field('matrix', 'matrix', { required: true }), {})).toBe(
      'Rate at least one row',
    )
    expect(
      validateFieldValue(field('photo', 'photo_ai', { required: true }), { attachments: [] }),
    ).toBe('Add a photo')
    expect(validateFieldValue(field('sketch', 'sketch', { required: true }), {})).toBe(
      'Add a diagram',
    )
    expect(validateFieldValue(field('gps', 'gps', { required: true }), {})).toBe('Required')
    expect(validateFieldValue(field('signature', 'signature', { required: true }), {})).toBe(
      'Required',
    )
    expect(
      validateFieldValue(field('attestation', 'typed_attestation'), {
        name: 'Alex Worker',
        agreed: false,
      }),
    ).toBe('Confirm the attestation')
    expect(
      validateFieldValue(field('answer', 'yes_no_comment'), { answer: 'no', comment: '   ' }),
    ).toBe('Add a comment')
    expect(validateFieldValue(field('slider', 'slider', { config: { min: 2, max: 8 } }), 1)).toBe(
      'Must be >= 2',
    )
    expect(
      validateFieldValue(field('slider', 'slider', { config: { min: 2, max: 8 } }), 8),
    ).toBeNull()
  })

  it('allows incomplete required values in drafts but still rejects malformed rich text', () => {
    expect(
      validateFieldValue(field('address', 'address', { required: true }), {}, 'draft'),
    ).toBeNull()
    expect(
      validateFieldValue(field('notes', 'rich_text'), { html: '<p>not a string</p>' }, 'draft'),
    ).toBe('Must be text')
  })

  it.each([
    ['address', { line1: 123 }, 'Must be an address'],
    ['matrix', [], 'Must be a rating grid'],
    ['photo_ai', { attachments: 'not-an-array' }, 'Invalid photo value'],
    ['photo_ai', { attachments: [ATTACHMENT], analysis: {} }, 'Invalid photo value'],
    [
      'photo_ai',
      { attachments: [ATTACHMENT], analysis: SAFETY_ANALYSIS, analyzedAt: 'not-a-date' },
      'Invalid photo value',
    ],
    ['photo_ai', { attachments: [ATTACHMENT], analysis: SAFETY_ANALYSIS }, 'Invalid photo value'],
    ['photo_annotated', { attachments: [], markers: 'not-an-array' }, 'Invalid photo value'],
    [
      'photo_annotated',
      { attachments: [ATTACHMENT], markers: [{ id: 'marker', x: 2, y: 0.5, label: '' }] },
      'Invalid photo value',
    ],
    ['sketch', { attachmentId: 123 }, 'Invalid diagram'],
    ['gps', { lat: '43.6', lng: -79.4 }, 'Invalid location'],
    ['signature', { attachmentId: 123 }, 'Invalid signature'],
    ['yes_no_comment', { answer: 1 }, 'Choose Yes or No'],
    ['typed_attestation', { agreed: 'yes' }, 'Invalid attestation'],
    [
      'risk_matrix',
      { severity: 2, likelihood: 3, score: Number.POSITIVE_INFINITY, label: 'High' },
      'Invalid risk rating',
    ],
    ['risk_matrix', { severity: 2, likelihood: 3, score: 5, label: 'High' }, 'Invalid risk rating'],
  ] as Array<[FormField['type'], unknown, string]>)(
    'rejects malformed optional %s compound values during draft validation',
    (type, value, expected) => {
      expect(validateFieldValue(field(type, type), value, 'draft')).toBe(expected)
    },
  )

  it.each([
    ['address', {}],
    ['matrix', {}],
    ['photo_ai', { attachments: [] }],
    ['photo_annotated', { attachments: [], markers: [] }],
    ['sketch', {}],
    ['gps', {}],
    ['signature', {}],
    ['yes_no_comment', {}],
    ['typed_attestation', {}],
    ['risk_matrix', {}],
  ] as Array<[FormField['type'], unknown]>)(
    'allows the canonical empty shape for optional %s values',
    (type, value) => {
      expect(validateFieldValue(field(type, type), value, 'draft')).toBeNull()
    },
  )

  it.each(['number', 'rating', 'slider'] as const)('rejects non-finite %s values', (type) => {
    expect(validateFieldValue(field(type, type), Number.POSITIVE_INFINITY)).toBe('Must be a number')
  })

  it.each([
    ['date', {}, 'Must be text'],
    ['date', '2026-02-30', 'Invalid date'],
    ['datetime', '2026-07-13 10:30', 'Invalid date and time'],
    ['time', '25:00', 'Invalid time'],
    ['person_picker', { id: 'person-id' }, 'Must be a selection'],
    ['lookup', 42, 'Must be a selection'],
    ['select', { value: 'choice' }, 'Must be a choice'],
    ['ranking', [{}], 'Must be a list of choices'],
    ['multi_person_picker', [42], 'Must be a list of people'],
    ['multi_person_picker', ['not-a-uuid'], 'Must be a list of people'],
    ['photo', [{}], 'Invalid attachment list'],
    ['number', '   ', 'Must be a number'],
    ['number', '2', 'Must be a number'],
    ['slider', '0x10', 'Must be a number'],
  ] as Array<[FormField['type'], unknown, string]>)(
    'rejects noncanonical %s value shapes',
    (type, value, expected) => {
      expect(validateFieldValue(field(type, type), value, 'draft')).toBe(expected)
    },
  )

  it('validates date/time strings and table row cell shapes', () => {
    expect(validateFieldValue(field('date', 'date'), '2024-02-29')).toBeNull()
    expect(validateFieldValue(field('datetime', 'datetime'), '2026-07-13T10:30')).toBeNull()
    expect(validateFieldValue(field('time', 'time'), '23:59:30')).toBeNull()

    const table = field('items', 'table', {
      config: {
        columns: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'active', label: 'Active', type: 'checkbox' },
          {
            key: 'kind',
            label: 'Kind',
            type: 'select',
            options: [{ value: 'tool', label: 'Tool' }],
          },
        ],
      },
    })
    expect(
      validateFieldValue(table, [
        { name: 'Harness', quantity: 2, active: true, kind: 'tool' },
        { name: '', quantity: null, kind: '' },
      ]),
    ).toBeNull()
    expect(validateFieldValue(table, [{ name: 'Harness', quantity: 'two' }])).toBe(
      'Invalid table row or cell value',
    )
    expect(validateFieldValue(table, [{ unknown: 'value' }])).toBe(
      'Invalid table row or cell value',
    )
    expect(
      validateFieldValue(
        field('minimum_items', 'table', {
          config: {
            columns: [{ key: 'item', label: 'Item', type: 'text' }],
            minRows: 1,
          },
        }),
        [],
      ),
    ).toBe('Add at least 1 row')
  })

  it('enforces configured numeric bounds, increments, and rating range', () => {
    const quantity = field('quantity', 'number', { config: { min: 1, max: 10, step: 0.5 } })
    expect(validateFieldValue(quantity, 0.5)).toBe('Must be >= 1')
    expect(validateFieldValue(quantity, 10.5)).toBe('Must be <= 10')
    expect(validateFieldValue(quantity, 1.25)).toBe('Must use increments of 0.5')
    expect(validateFieldValue(quantity, 1.5)).toBeNull()

    const slider = field('slider', 'slider', { config: { min: 0.1, max: 1, step: 0.1 } })
    expect(validateFieldValue(slider, 0.3)).toBeNull()
    expect(validateFieldValue(slider, 0.35)).toBe('Must use increments of 0.1')

    expect(validateFieldValue(field('rating', 'rating'), 6)).toBe(
      'Must be a whole-number rating from 1 to 5',
    )
    expect(validateFieldValue(field('rating', 'rating', { config: { max: 10 } }), 10)).toBeNull()
    expect(validateFieldValue(field('rating', 'rating', { config: { max: 10 } }), 2.5)).toBe(
      'Must be a whole-number rating from 1 to 10',
    )

    const constrainedRating = field('rating', 'rating', {
      config: { max: 5 },
      validation: { min: 2, max: 4 },
    })
    expect(validateFieldValue(constrainedRating, 1)).toBe(
      'Must be a whole-number rating from 2 to 4',
    )
    expect(validateFieldValue(constrainedRating, 3)).toBeNull()
    expect(validateFieldValue(constrainedRating, 5)).toBe(
      'Must be a whole-number rating from 2 to 4',
    )

    const historicalConflictingNumber = field('quantity', 'number', {
      config: { min: 1, max: 10 },
      validation: { min: 0, max: 11 },
    })
    expect(validateFieldValue(historicalConflictingNumber, 0.5)).toBe('Must be >= 1')
    expect(validateFieldValue(historicalConflictingNumber, 10.5)).toBe('Must be <= 10')

    expect(validateFieldValue(field('default_slider', 'slider'), -1)).toBe('Must be >= 0')
    expect(validateFieldValue(field('default_slider', 'slider'), 11)).toBe('Must be <= 10')
    expect(validateFieldValue(field('default_slider', 'slider'), 0.5)).toBe(
      'Must use increments of 1',
    )
  })

  it('validates data-table selections but treats display-only tables as non-response fields', () => {
    const selectable = field('records', 'data_table', {
      binding: { sourceKey: 'records', selectable: 'multi' },
    })
    const displayOnly = field('record_list', 'data_table', {
      binding: { sourceKey: 'records', selectable: 'none' },
    })

    expect(validateFieldValue(selectable, [{ id: 'row-id' }], 'draft')).toBe(
      'Must be a list of selections',
    )
    expect(validateFieldValue(selectable, ['row-id'], 'draft')).toBeNull()
    expect(validateFieldValue(displayOnly, ['caller-value'], 'draft')).toBeNull()
    expect(
      validateResponse(schemaWith([displayOnly]), { record_list: ['caller-value'] }, 'draft'),
    ).toEqual([{ fieldId: 'record_list', message: 'Unknown response field' }])
  })

  it('requires canonical UUIDs for entity picker values', () => {
    expect(validateFieldValue(field('person', 'person_picker'), ATTACHMENT_ID)).toBeNull()
    expect(validateFieldValue(field('site', 'site_picker'), 'site-id')).toBe('Must be a selection')
    expect(validateFieldValue(field('people', 'multi_person_picker'), [ATTACHMENT_ID])).toBeNull()
  })

  it('accepts canonical private attachment values and complete photo compounds', () => {
    expect(validateFieldValue(field('photo', 'photo'), [ATTACHMENT])).toBeNull()
    expect(
      validateFieldValue(field('photo_ai', 'photo_ai'), {
        attachments: [ATTACHMENT],
        analysis: SAFETY_ANALYSIS,
        analyzedAt: '2026-07-13T12:00:00.000Z',
      }),
    ).toBeNull()
    expect(
      validateFieldValue(field('annotated', 'photo_annotated'), {
        attachments: [ATTACHMENT],
        markers: [{ id: 'marker-1', x: 0.25, y: 0.75, label: '' }],
      }),
    ).toBeNull()
    expect(
      validateFieldValue(field('signature', 'signature'), {
        attachmentId: ATTACHMENT_ID,
        url: ATTACHMENT_URL,
      }),
    ).toBeNull()
    expect(
      validateFieldValue(field('sketch', 'sketch'), {
        attachmentId: ATTACHMENT_ID,
        url: ATTACHMENT_URL,
        scene: { elements: [], appState: {}, files: {} },
      }),
    ).toBeNull()
  })

  it('accepts the numeric risk-matrix value emitted by the shared picker', () => {
    expect(
      validateFieldValue(field('risk', 'risk_matrix'), {
        likelihood: 3,
        severity: 4,
        score: 12,
        label: 'High',
      }),
    ).toBeNull()
  })

  it('rejects malformed or oversized sketch scene data', () => {
    const sketch = (scene: Record<string, unknown>) => ({
      attachmentId: ATTACHMENT_ID,
      url: ATTACHMENT_URL,
      scene,
    })
    const element = {
      id: 'element-1',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      angle: 0,
    }

    expect(
      validateFieldValue(
        field('sketch', 'sketch'),
        sketch({ elements: [null], appState: {}, files: {} }),
      ),
    ).toBe('Invalid diagram')
    expect(
      validateFieldValue(
        field('sketch', 'sketch'),
        sketch({
          elements: Array.from({ length: 501 }, (_, index) => ({
            ...element,
            id: `element-${index}`,
          })),
          appState: {},
          files: {},
        }),
      ),
    ).toBe('Invalid diagram')
    expect(
      validateFieldValue(
        field('sketch', 'sketch'),
        sketch({
          elements: [{ ...element, x: Number.POSITIVE_INFINITY }],
          appState: {},
          files: {},
        }),
      ),
    ).toBe('Invalid diagram')
    expect(
      validateFieldValue(
        field('sketch', 'sketch'),
        sketch({ elements: [element], appState: {}, files: {} }),
      ),
    ).toBeNull()
  })

  it('enforces hard collection and text bounds independent of designer configuration', () => {
    expect(
      validateFieldValue(
        field('people', 'multi_person_picker'),
        Array.from({ length: 101 }, (_, index) => `person-${index}`),
      ),
    ).toBe('Must be a list of people')
    expect(
      validateFieldValue(
        field('photos', 'photo'),
        Array.from({ length: 51 }, () => ATTACHMENT),
      ),
    ).toBe('Invalid attachment list')
    expect(validateFieldValue(field('notes', 'long_text'), 'a'.repeat(100_001))).toBe(
      'Text is too long',
    )
    expect(validateFieldValue(field('quantity', 'number'), 1_000_000_001)).toBe(
      'Must be between -1000000000 and 1000000000',
    )
    expect(
      validateFieldValue(
        field('measurements', 'table', {
          config: { columns: [{ key: 'value', label: 'Value', type: 'number' }] },
        }),
        [{ value: 1_000_000_001 }],
      ),
    ).toBe('Invalid table row or cell value')
  })

  it('fails closed for an unsafe pattern on a historical unparsed schema', () => {
    const unsafe = field('code', 'text', { validation: { pattern: '^a+a+$' } })
    expect(validateFieldValue(unsafe, `${'a'.repeat(8_000)}b`)).toBe('Invalid format')
  })

  it.each([
    ['photo', [{ ...ATTACHMENT, url: 'https://tracker.example/photo.jpg' }]],
    ['photo_ai', { attachments: [{ ...ATTACHMENT, url: 'https://tracker.example/photo.jpg' }] }],
    [
      'photo_annotated',
      { attachments: [{ ...ATTACHMENT, url: 'https://tracker.example/photo.jpg' }], markers: [] },
    ],
    ['signature', { attachmentId: ATTACHMENT_ID, url: 'https://tracker.example/signature.png' }],
    ['sketch', { attachmentId: ATTACHMENT_ID, url: 'https://tracker.example/sketch.png' }],
  ] as Array<[FormField['type'], unknown]>)(
    'rejects an external URL in %s values',
    (type, value) => {
      expect(validateFieldValue(field(type, type), value, 'draft')).not.toBeNull()
    },
  )

  it('rejects an attachment URL whose embedded id does not match the value', () => {
    expect(
      validateFieldValue(field('photo', 'photo'), [
        { ...ATTACHMENT, attachmentId: '20000000-0000-4000-8000-000000000002' },
      ]),
    ).toBe('Invalid attachment list')
  })

  it.each(['formula', 'heading', 'paragraph', 'divider', 'metric'] as const)(
    'never validates display-only %s fields',
    (type) => {
      expect(validateFieldValue(field(type, type, { required: true }), undefined)).toBeNull()
    },
  )
})

describe('validateResponse', () => {
  it('enforces compound and rich-text semantics on top-level fields', () => {
    const schema = schemaWith([
      field('notes', 'rich_text', { required: true }),
      field('address', 'address', { required: true }),
      field('matrix', 'matrix', { required: true }),
      field('photo_ai', 'photo_ai', { required: true }),
      field('photo_annotated', 'photo_annotated', { required: true }),
      field('sketch', 'sketch', { required: true }),
      field('slider', 'slider', { config: { min: 5, max: 10 } }),
    ])

    expect(
      validateResponse(
        schema,
        {
          notes: '<p>&nbsp;</p>',
          address: {},
          matrix: {},
          photo_ai: { attachments: [] },
          photo_annotated: { attachments: [] },
          sketch: {},
          slider: 4,
        },
        'submit',
      ),
    ).toEqual([
      { fieldId: 'notes', sectionId: 'section', message: 'Required' },
      { fieldId: 'address', sectionId: 'section', message: 'Required' },
      { fieldId: 'matrix', sectionId: 'section', message: 'Rate at least one row' },
      { fieldId: 'photo_ai', sectionId: 'section', message: 'Add a photo' },
      { fieldId: 'photo_annotated', sectionId: 'section', message: 'Add a photo' },
      { fieldId: 'sketch', sectionId: 'section', message: 'Add a diagram' },
      { fieldId: 'slider', sectionId: 'section', message: 'Must be >= 5' },
    ])
  })

  it('reports the same semantics with repeating-row composite field ids', () => {
    const schema = schemaWith(
      [
        field('notes', 'rich_text', { required: true }),
        field('address', 'address', { required: true }),
      ],
      true,
    )

    expect(
      validateResponse(schema, { section: [{ notes: '<div><br></div>', address: {} }] }),
    ).toEqual([
      { fieldId: 'section.0.notes', sectionId: 'section', message: 'Required' },
      { fieldId: 'section.0.address', sectionId: 'section', message: 'Required' },
    ])
  })

  it('rejects unknown top-level and repeating-row keys plus malformed rows', () => {
    const schema = schemaWith([field('notes', 'text')], true)

    expect(
      validateResponse(schema, {
        __internal: 'not response metadata',
        section: [{ notes: 'Known', unexpected: 'drop me' }, 'not an object'] as unknown as Array<
          Record<string, unknown>
        >,
      }),
    ).toEqual([
      { fieldId: '__internal', message: 'Unknown response field' },
      {
        fieldId: 'section.0.unexpected',
        sectionId: 'section',
        message: 'Unknown response field',
      },
      {
        fieldId: 'section.1',
        sectionId: 'section',
        message: 'Repeating row must be an object',
      },
    ])
  })

  it.each(['formula', 'heading', 'paragraph', 'divider', 'metric'] as const)(
    'rejects caller-supplied values for non-response %s fields',
    (type) => {
      const topLevelSchema = schemaWith([field(type, type)])
      expect(validateResponse(topLevelSchema, { [type]: { arbitrary: 'data' } }, 'draft')).toEqual([
        { fieldId: type, message: 'Unknown response field' },
      ])

      const repeatingSchema = schemaWith([field(type, type)], true)
      expect(
        validateResponse(
          repeatingSchema,
          { section: [{ [type]: { arbitrary: 'data' } }] },
          'draft',
        ),
      ).toEqual([
        {
          fieldId: `section.0.${type}`,
          sectionId: 'section',
          message: 'Unknown response field',
        },
      ])
    },
  )

  it('rejects a non-array repeating-section value', () => {
    const schema = schemaWith([field('notes', 'text')], true)

    expect(validateResponse(schema, { section: 'not rows' })).toEqual([
      { fieldId: 'section', sectionId: 'section', message: 'Must be a list of rows' },
    ])
  })

  it('validates supplied hidden values as drafts while relaxing hidden completion rules', () => {
    const schema = schemaWith([
      field('controller', 'text'),
      field('hidden_address', 'address', {
        required: true,
        showIf: { op: 'eq', field: 'controller', value: 'show' },
      }),
    ])

    expect(validateResponse(schema, { controller: 'hide' }, 'submit')).toEqual([])
    expect(
      validateResponse(schema, { controller: 'hide', hidden_address: { line1: 123 } }, 'submit'),
    ).toEqual([
      {
        fieldId: 'hidden_address',
        sectionId: 'section',
        message: 'Must be an address',
      },
    ])
  })

  it('bounds repeating rows before field traversal', () => {
    const schema = schemaWith([field('notes', 'text')], true)
    expect(
      validateResponse(
        schema,
        { section: Array.from({ length: 501 }, () => ({ notes: 'bounded' })) },
        'draft',
      ),
    ).toEqual([
      {
        fieldId: 'section',
        sectionId: 'section',
        message: 'Use no more than 500 rows',
      },
    ])
  })
})
