import { describe, expect, it } from 'vitest'
import { formSchemaV1, lintFormSchema, type FormSchemaV1 } from './schema'

function schemaWithIdentifierCollisions(): unknown {
  return {
    schemaVersion: 1,
    title: { en: 'Identifier test' },
    sections: [
      {
        id: 'overview',
        fields: [{ id: 'shared_field', type: 'text', label: { en: 'First field' } }],
      },
      {
        id: 'details',
        fields: [{ id: 'other_field', type: 'text', label: { en: 'Other field' } }],
      },
      {
        id: 'overview',
        fields: [{ id: 'shared_field', type: 'text', label: { en: 'Duplicate field' } }],
      },
    ],
    tabs: [
      { id: 'main', title: { en: 'Main' } },
      { id: 'main', title: { en: 'Duplicate main' } },
    ],
    workflow: {
      steps: [
        {
          key: 'submit',
          title: { en: 'Submit' },
          assignee: { type: 'role', role: 'worker' },
        },
        {
          key: 'submit',
          title: { en: 'Duplicate submit' },
          assignee: { type: 'role', role: 'supervisor' },
        },
      ],
    },
  }
}

const expectedIssues = [
  {
    path: ['sections', 2, 'id'],
    message: 'Duplicate section id "overview"; first declared at sections[0].id',
  },
  {
    path: ['sections', 2, 'fields', 0, 'id'],
    message: 'Duplicate field id "shared_field"; first declared at sections[0].fields[0].id',
  },
  {
    path: ['tabs', 1, 'id'],
    message: 'Duplicate tab id "main"; first declared at tabs[0].id',
  },
  {
    path: ['workflow', 'steps', 1, 'key'],
    message: 'Duplicate workflow step key "submit"; first declared at workflow.steps[0].key',
  },
]

function lintMessages(issues: Array<{ path: Array<string | number>; message: string }>): string[] {
  return issues.map(({ path, message }) => {
    const label = path
      .map((part, index) =>
        typeof part === 'number' ? `[${part}]` : `${index === 0 ? '' : '.'}${part}`,
      )
      .join('')
    return `${label}: ${message}`
  })
}

describe('formSchemaV1 identifier uniqueness', () => {
  it('rejects every ambiguous identifier at the duplicate declaration path', () => {
    const result = formSchemaV1.safeParse(schemaWithIdentifierCollisions())

    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected schema parsing to fail')
    expect(result.error.issues.map(({ path, message }) => ({ path, message }))).toEqual(
      expectedIssues,
    )
  })

  it('surfaces the same invariant through designer lint without a second implementation', () => {
    const schema = schemaWithIdentifierCollisions() as FormSchemaV1

    expect(lintFormSchema(schema).slice(0, 4)).toEqual(lintMessages(expectedIssues))
  })

  it('rejects response-key collisions, reserved field ids, and unknown section tabs', () => {
    const invalid = {
      schemaVersion: 1,
      title: { en: 'Namespace test' },
      sections: [
        {
          id: 'overview',
          tabId: 'missing_tab',
          fields: [
            { id: 'observations', type: 'text', label: { en: 'Collision' } },
            { id: '__section_observations', type: 'text', label: { en: 'Reserved' } },
          ],
        },
        {
          id: 'observations',
          repeating: true,
          fields: [{ id: 'finding', type: 'text', label: { en: 'Finding' } }],
        },
      ],
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
    const expected = [
      {
        path: ['sections', 0, 'fields', 0, 'id'],
        message:
          'Top-level field id "observations" collides with repeating section response key declared at sections[1].id',
      },
      {
        path: ['sections', 0, 'fields', 1, 'id'],
        message: 'Field id "__section_observations" uses reserved prefix "__section_"',
      },
      {
        path: ['sections', 0, 'tabId'],
        message: 'Section tabId "missing_tab" does not reference a declared tab',
      },
    ]

    const parsed = formSchemaV1.safeParse(invalid)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues.map(({ path, message }) => ({ path, message }))).toEqual(expected)

    expect(lintFormSchema(invalid as FormSchemaV1).slice(0, 3)).toEqual(lintMessages(expected))
  })

  it('rejects unknown workflow steps and inverted row bounds', () => {
    const invalid = {
      schemaVersion: 1,
      title: { en: 'Bounds test' },
      sections: [
        {
          id: 'observations',
          repeating: true,
          minRows: 3,
          maxRows: 2,
          step: 'missing_step',
          fields: [
            {
              id: 'items',
              type: 'table',
              label: { en: 'Items' },
              config: {
                columns: [{ key: 'item', label: 'Item', type: 'text' }],
                minRows: 4,
                maxRows: 1,
              },
            },
          ],
        },
      ],
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
    const expected = [
      {
        path: ['sections', 0, 'maxRows'],
        message: 'Repeating section maxRows (2) must be greater than or equal to minRows (3)',
      },
      {
        path: ['sections', 0, 'fields', 0, 'config', 'maxRows'],
        message: 'Table maxRows (1) must be greater than or equal to minRows (4)',
      },
      {
        path: ['sections', 0, 'step'],
        message: 'Section step "missing_step" does not reference a declared workflow step',
      },
    ]

    const parsed = formSchemaV1.safeParse(invalid)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues.map(({ path, message }) => ({ path, message }))).toEqual(expected)

    expect(lintFormSchema(invalid as FormSchemaV1).slice(0, 3)).toEqual(lintMessages(expected))
  })

  it('rejects identifiers that are ambiguous in response maps and composite error paths', () => {
    const invalid = {
      schemaVersion: 1,
      title: { en: 'Unsafe identifiers' },
      sections: [
        {
          id: 'bad.section',
          fields: [{ id: '__proto__', type: 'text', label: { en: 'Unsafe field' } }],
        },
      ],
      tabs: [{ id: 'constructor', title: { en: 'Unsafe tab' } }],
      workflow: {
        steps: [
          {
            key: 'bad.step',
            title: { en: 'Unsafe step' },
            assignee: { type: 'role', role: 'worker' },
          },
        ],
      },
    }
    const expected = [
      {
        path: ['sections', 0, 'id'],
        message: 'Section id may contain only letters, numbers, underscores, and hyphens',
      },
      {
        path: ['sections', 0, 'fields', 0, 'id'],
        message: 'Field id uses reserved key "__proto__"',
      },
      {
        path: ['tabs', 0, 'id'],
        message: 'Tab id uses reserved key "constructor"',
      },
      {
        path: ['workflow', 'steps', 0, 'key'],
        message: 'Workflow step key may contain only letters, numbers, underscores, and hyphens',
      },
    ]

    const parsed = formSchemaV1.safeParse(invalid)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues.map(({ path, message }) => ({ path, message }))).toEqual(expected)
    expect(lintFormSchema(invalid as FormSchemaV1).slice(0, 4)).toEqual(lintMessages(expected))
  })

  it('rejects showIf references the evaluator cannot resolve', () => {
    const invalid = {
      schemaVersion: 1,
      title: { en: 'Logic references' },
      sections: [
        {
          id: 'overview',
          fields: [
            { id: 'controller', type: 'text', label: { en: 'Controller' } },
            {
              id: 'self_hidden',
              type: 'text',
              label: { en: 'Self hidden' },
              showIf: { op: 'isSet', field: 'self_hidden' },
            },
            {
              id: 'bad_top_level',
              type: 'text',
              label: { en: 'Bad top-level reference' },
              showIf: { op: 'isSet', field: 'row_controller' },
            },
            {
              id: 'unknown_reference',
              type: 'text',
              label: { en: 'Unknown reference' },
              showIf: { op: 'isSet', field: 'missing' },
            },
          ],
        },
        {
          id: 'rows',
          repeating: true,
          fields: [
            { id: 'row_controller', type: 'text', label: { en: 'Row controller' } },
            {
              id: 'row_detail',
              type: 'text',
              label: { en: 'Row detail' },
              showIf: { op: 'isSet', field: 'row_controller' },
            },
          ],
        },
      ],
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
    const expected = [
      {
        path: ['sections', 0, 'fields', 1, 'showIf'],
        message: 'Field "self_hidden" showIf cannot reference itself',
      },
      {
        path: ['sections', 0, 'fields', 2, 'showIf'],
        message: 'showIf references field "row_controller" outside its evaluation context',
      },
      {
        path: ['sections', 0, 'fields', 3, 'showIf'],
        message: 'showIf references unknown field "missing"',
      },
    ]

    const parsed = formSchemaV1.safeParse(invalid)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues.map(({ path, message }) => ({ path, message }))).toEqual(expected)
    expect(lintFormSchema(invalid as FormSchemaV1)).toEqual(lintMessages(expected))
  })
})

function schemaWithField(field: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    title: { en: 'Configuration test' },
    sections: [{ id: 'section', fields: [field] }],
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

describe('formSchemaV1 field configuration invariants', () => {
  it.each([
    [
      'matrix rows',
      { id: 'matrix', type: 'matrix', label: { en: 'Matrix' }, config: { rows: [null] } },
      ['sections', 0, 'fields', 0, 'config', 'rows', 0],
      'Invalid matrix config',
    ],
    [
      'table columns',
      { id: 'table', type: 'table', label: { en: 'Table' }, config: { columns: [null] } },
      ['sections', 0, 'fields', 0, 'config', 'columns', 0],
      'Invalid table config',
    ],
    [
      'rating maximum',
      { id: 'rating', type: 'rating', label: { en: 'Rating' }, config: { max: 1e9 } },
      ['sections', 0, 'fields', 0, 'config', 'max'],
      'Rating max must be an integer from 1 to 10',
    ],
    [
      'slider step',
      {
        id: 'slider',
        type: 'slider',
        label: { en: 'Slider' },
        config: { min: 0, max: 10, step: 0 },
      },
      ['sections', 0, 'fields', 0, 'config', 'step'],
      'slider step must be greater than zero',
    ],
    [
      'fixed table rows',
      {
        id: 'table',
        type: 'table',
        label: { en: 'Table' },
        config: {
          columns: [{ key: 'item', label: 'Item', type: 'text' }],
          rowMode: 'fixed',
          rows: [],
        },
      },
      ['sections', 0, 'fields', 0, 'config', 'rows'],
      'Fixed tables require at least one predefined row',
    ],
    [
      'empty choices',
      { id: 'choice', type: 'select', label: { en: 'Choice' }, validation: { options: [] } },
      ['sections', 0, 'fields', 0, 'validation', 'options'],
      'select fields require at least one choice option',
    ],
    [
      'numeric validation on a nonnumeric field',
      { id: 'notes', type: 'text', label: { en: 'Notes' }, validation: { min: 1 } },
      ['sections', 0, 'fields', 0, 'validation'],
      'text fields cannot define numeric min or max validation',
    ],
    [
      'text validation on a nontext field',
      {
        id: 'quantity',
        type: 'number',
        label: { en: 'Quantity' },
        validation: { maxLength: 10 },
      },
      ['sections', 0, 'fields', 0, 'validation'],
      'number fields cannot define text-length or pattern validation',
    ],
    [
      'options on a nonchoice field',
      {
        id: 'quantity',
        type: 'number',
        label: { en: 'Quantity' },
        validation: { options: [{ value: '1', label: { en: 'One' } }] },
      },
      ['sections', 0, 'fields', 0, 'validation', 'options'],
      'number fields cannot define choice options',
    ],
    [
      'custom ranking values',
      {
        id: 'rank',
        type: 'ranking',
        label: { en: 'Rank' },
        validation: {
          options: [{ value: 'first', label: { en: 'First' } }],
          allowOther: true,
        },
      },
      ['sections', 0, 'fields', 0, 'validation', 'allowOther'],
      'ranking fields do not support custom choice values',
    ],
    [
      'impossible email length',
      {
        id: 'email',
        type: 'email',
        label: { en: 'Email' },
        validation: { minLength: 321 },
      },
      ['sections', 0, 'fields', 0, 'validation', 'minLength'],
      'email minLength cannot exceed its 320-character response limit',
    ],
    [
      'validation outside slider range',
      {
        id: 'slider',
        type: 'slider',
        label: { en: 'Slider' },
        config: { min: 2, max: 8 },
        validation: { min: 1 },
      },
      ['sections', 0, 'fields', 0, 'validation', 'min'],
      'Validation min (1) cannot be below configured min (2)',
    ],
    [
      'validation disjoint from slider range',
      {
        id: 'slider',
        type: 'slider',
        label: { en: 'Slider' },
        config: { min: 0, max: 10 },
        validation: { min: 11 },
      },
      ['sections', 0, 'fields', 0, 'validation'],
      'Validation range does not overlap the configured slider range',
    ],
    [
      'validation without a step-aligned slider value',
      {
        id: 'slider',
        type: 'slider',
        label: { en: 'Slider' },
        config: { min: 0, max: 10, step: 2 },
        validation: { min: 3, max: 3 },
      },
      ['sections', 0, 'fields', 0, 'validation'],
      'Validation range contains no value aligned to the slider step (2)',
    ],
    [
      'validation outside rating scale',
      {
        id: 'rating',
        type: 'rating',
        label: { en: 'Rating' },
        validation: { max: 6 },
      },
      ['sections', 0, 'fields', 0, 'validation', 'max'],
      'Rating validation max cannot exceed the 5-point scale',
    ],
    [
      'validation above rating scale',
      {
        id: 'rating',
        type: 'rating',
        label: { en: 'Rating' },
        validation: { min: 6 },
      },
      ['sections', 0, 'fields', 0, 'validation', 'min'],
      'Rating validation min cannot exceed the 5-point scale',
    ],
    [
      'formula expression',
      { id: 'total', type: 'formula', label: { en: 'Total' } },
      ['sections', 0, 'fields', 0, 'formula'],
      'Formula fields require a formula expression',
    ],
    [
      'data binding',
      { id: 'lookup', type: 'lookup', label: { en: 'Lookup' } },
      ['sections', 0, 'fields', 0, 'binding'],
      'lookup fields require a data-source binding',
    ],
    [
      'display-only data table validation',
      {
        id: 'records',
        type: 'data_table',
        label: { en: 'Records' },
        required: true,
        binding: { sourceKey: 'records', selectable: 'none' },
      },
      ['sections', 0, 'fields', 0, 'required'],
      'data_table does not store a response value and cannot be required',
    ],
  ])('rejects invalid %s through parse and designer lint', (_name, field, path, message) => {
    const input = schemaWithField(field as Record<string, unknown>)
    const parsed = formSchemaV1.safeParse(input)

    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, message: expect.stringContaining(message) }),
      ]),
    )
    expect(lintFormSchema(input as FormSchemaV1)).toEqual(
      expect.arrayContaining([expect.stringContaining(message)]),
    )
  })

  it.each([
    {
      id: 'quantity',
      type: 'number',
      label: { en: 'Quantity' },
      config: { min: 0, max: 10 },
      validation: { min: 2, max: 8 },
    },
    {
      id: 'rating',
      type: 'rating',
      label: { en: 'Rating' },
      config: { max: 10 },
      validation: { min: 2, max: 9 },
    },
    {
      id: 'email',
      type: 'email',
      label: { en: 'Email' },
      validation: { minLength: 5, maxLength: 320 },
    },
  ])('accepts compatible validation for $type fields', (field) => {
    const input = schemaWithField(field)

    expect(formSchemaV1.safeParse(input).success).toBe(true)
    expect(lintFormSchema(input as FormSchemaV1)).toEqual([])
  })

  it.each([
    '(a+)+$',
    '^(a|aa)*$',
    '^(?=a)a$',
    '^(a)\\1$',
    '^a+a+$',
    '^[a-z]*[a-z]*$',
    '^.*.*X$',
    '^(a|a)(a|a)(a|a)b$',
  ])('rejects unsafe validation pattern %s without executing it', (pattern) => {
    const input = schemaWithField({
      id: 'code',
      type: 'text',
      label: { en: 'Code' },
      validation: { pattern },
    })
    const parsed = formSchemaV1.safeParse(input)

    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['sections', 0, 'fields', 0, 'validation', 'pattern'],
          message: expect.stringContaining('Validation pattern'),
        }),
      ]),
    )
    expect(lintFormSchema(input as FormSchemaV1)).toEqual(
      expect.arrayContaining([expect.stringContaining('Validation pattern')]),
    )
  })

  it('accepts a bounded practical field mask', () => {
    const input = schemaWithField({
      id: 'employee_number',
      type: 'text',
      label: { en: 'Employee number' },
      validation: { pattern: '^[A-Z]{2}-[0-9]{4}$' },
    })

    expect(formSchemaV1.safeParse(input).success).toBe(true)
    expect(lintFormSchema(input as FormSchemaV1)).toEqual([])
  })
})

describe('formSchemaV1 executable reference invariants', () => {
  it('accepts formula references that every runtime evaluation context can resolve', () => {
    const input = {
      schemaVersion: 1,
      title: { en: 'Valid formulas' },
      sections: [
        {
          id: 'overview',
          fields: [
            { id: 'hours', type: 'number', label: { en: 'Hours' } },
            { id: 'site', type: 'site_picker', label: { en: 'Site' } },
            {
              id: 'total',
              type: 'formula',
              label: { en: 'Total' },
              formula: {
                kind: 'sum',
                of: [
                  { kind: 'field_ref', fieldKey: 'hours' },
                  { kind: 'sum_section', sectionKey: 'entries', rowFieldKey: 'amount' },
                ],
              },
            },
            {
              id: 'site_name',
              type: 'formula',
              label: { en: 'Site name' },
              formula: { kind: 'entity_attr', pickerFieldKey: 'site', attrKey: 'name' },
            },
          ],
        },
        {
          id: 'entries',
          repeating: true,
          fields: [
            { id: 'amount', type: 'number', label: { en: 'Amount' } },
            {
              id: 'double_amount',
              type: 'formula',
              label: { en: 'Double amount' },
              formula: {
                kind: 'product',
                of: [
                  { kind: 'field_ref', fieldKey: 'amount' },
                  { kind: 'literal', value: 2 },
                ],
              },
            },
          ],
        },
      ],
      workflow: {
        steps: [
          {
            key: 'submit',
            title: { en: 'Submit' },
            assignee: { type: 'role', role: 'worker' },
          },
        ],
        scoreRouting: {
          scoreFormula: { kind: 'field_ref', fieldKey: 'hours' },
          hardFailRules: [{ kind: 'any_field_eq', fieldKeys: ['amount'], value: '0' }],
        },
      },
    }

    expect(formSchemaV1.safeParse(input).success).toBe(true)
    expect(lintFormSchema(input as FormSchemaV1)).toEqual([])
  })

  it('rejects formula references that would silently evaluate to null or zero', () => {
    const input = {
      schemaVersion: 1,
      title: { en: 'Invalid formulas' },
      sections: [
        {
          id: 'overview',
          fields: [
            { id: 'hours', type: 'number', label: { en: 'Hours' } },
            { id: 'not_a_picker', type: 'text', label: { en: 'Text' } },
            {
              id: 'bad_direct',
              type: 'formula',
              label: { en: 'Bad direct' },
              formula: { kind: 'field_ref', fieldKey: 'row_amount' },
            },
            {
              id: 'bad_section',
              type: 'formula',
              label: { en: 'Bad section' },
              formula: { kind: 'count_section', sectionKey: 'overview' },
            },
            {
              id: 'bad_row',
              type: 'formula',
              label: { en: 'Bad row' },
              formula: {
                kind: 'sum_section',
                sectionKey: 'entries',
                rowFieldKey: 'missing',
              },
            },
            {
              id: 'bad_entity',
              type: 'formula',
              label: { en: 'Bad entity' },
              formula: {
                kind: 'entity_attr',
                pickerFieldKey: 'not_a_picker',
                attrKey: 'passwordHash',
              },
            },
            {
              id: 'not_formula',
              type: 'text',
              label: { en: 'Not formula' },
              formula: { kind: 'literal', value: 1 },
              config: { expr: 'hours * 2' },
            },
          ],
        },
        {
          id: 'entries',
          repeating: true,
          fields: [{ id: 'row_amount', type: 'number', label: { en: 'Row amount' } }],
        },
      ],
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

    const parsed = formSchemaV1.safeParse(input)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['sections', 0, 'fields', 2, 'formula', 'fieldKey'],
          message: expect.stringContaining('outside its evaluation context'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 3, 'formula', 'sectionKey'],
          message: expect.stringContaining('is not repeating'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 4, 'formula', 'rowFieldKey'],
          message: expect.stringContaining('unknown row field'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 5, 'formula', 'pickerFieldKey'],
          message: expect.stringContaining('not a compatible top-level picker'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 6, 'formula'],
          message: 'Only formula fields may define a formula expression',
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 6, 'config', 'expr'],
          message: expect.stringContaining('Legacy string formulas are not supported'),
        }),
      ]),
    )
  })

  it('rejects data bindings that write or read outside their runtime context', () => {
    const input = {
      schemaVersion: 1,
      title: { en: 'Invalid bindings' },
      sections: [
        {
          id: 'overview',
          fields: [
            { id: 'parent', type: 'text', label: { en: 'Parent' } },
            {
              id: 'lookup',
              type: 'lookup',
              label: { en: 'Lookup' },
              binding: {
                sourceKey: 'assets',
                filterByField: 'row_value',
                filterColumn: 'parent_id',
                selectable: 'multi',
                autofill: [
                  { column: 'name', targetFieldId: 'row_value' },
                  { column: 'code', targetFieldId: 'row_value' },
                ],
              },
            },
            {
              id: 'metric',
              type: 'metric',
              label: { en: 'Metric' },
              binding: {
                sourceKey: 'assets',
                aggregate: { fn: 'sum' },
                display: 'pie',
              },
            },
          ],
        },
        {
          id: 'rows',
          repeating: true,
          fields: [
            { id: 'row_value', type: 'text', label: { en: 'Row value' } },
            {
              id: 'row_lookup',
              type: 'lookup',
              label: { en: 'Row lookup' },
              binding: {
                sourceKey: 'assets',
                autofill: [{ column: 'name', targetFieldId: 'parent' }],
              },
            },
          ],
        },
      ],
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

    const parsed = formSchemaV1.safeParse(input)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['sections', 0, 'fields', 1, 'binding', 'selectable'],
          message: expect.stringContaining('lookup bindings do not support'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 1, 'binding', 'filterByField'],
          message: expect.stringContaining('outside its evaluation context'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 1, 'binding', 'autofill', 0, 'targetFieldId'],
          message: expect.stringContaining('outside its writable response context'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 1, 'binding', 'autofill', 1, 'targetFieldId'],
          message: expect.stringContaining('Duplicate auto-fill target'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 2, 'binding', 'aggregate', 'column'],
          message: expect.stringContaining('sum metrics require'),
        }),
        expect.objectContaining({
          path: ['sections', 0, 'fields', 2, 'binding', 'display'],
          message: expect.stringContaining('Ungrouped metrics'),
        }),
        expect.objectContaining({
          path: ['sections', 1, 'fields', 1, 'binding', 'autofill', 0, 'targetFieldId'],
          message: expect.stringContaining('outside its writable response context'),
        }),
      ]),
    )
  })

  it('rejects score routing that targets unknown or non-response fields', () => {
    const input = {
      schemaVersion: 1,
      title: { en: 'Invalid score routing' },
      sections: [
        {
          id: 'overview',
          fields: [
            { id: 'result', type: 'pass_fail_na', label: { en: 'Result' } },
            {
              id: 'computed',
              type: 'formula',
              label: { en: 'Computed' },
              formula: { kind: 'literal', value: 1 },
            },
          ],
        },
      ],
      workflow: {
        steps: [
          {
            key: 'submit',
            title: { en: 'Submit' },
            assignee: { type: 'role', role: 'worker' },
          },
        ],
        scoreRouting: {
          scoreFormula: { kind: 'field_ref', fieldKey: 'computed' },
          hardFailRules: [
            {
              kind: 'any_field_in',
              fieldKeys: ['computed', 'missing', 'result', 'result'],
              values: ['fail', 'fail'],
            },
          ],
        },
      },
    }

    const parsed = formSchemaV1.safeParse(input)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected schema parsing to fail')
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['workflow', 'scoreRouting', 'scoreFormula', 'fieldKey'],
          message: expect.stringContaining('outside its evaluation context'),
        }),
        expect.objectContaining({
          path: ['workflow', 'scoreRouting', 'hardFailRules', 0, 'fieldKeys', 0],
          message: expect.stringContaining('does not store a response value'),
        }),
        expect.objectContaining({
          path: ['workflow', 'scoreRouting', 'hardFailRules', 0, 'fieldKeys', 1],
          message: expect.stringContaining('unknown field'),
        }),
        expect.objectContaining({
          path: ['workflow', 'scoreRouting', 'hardFailRules', 0, 'fieldKeys', 3],
          message: expect.stringContaining('Duplicate hard-fail field'),
        }),
        expect.objectContaining({
          path: ['workflow', 'scoreRouting', 'hardFailRules', 0, 'values', 1],
          message: expect.stringContaining('Duplicate hard-fail value'),
        }),
      ]),
    )
  })

  it('rejects unsupported formula precision and metric display modes structurally', () => {
    const invalidFormula = schemaWithField({
      id: 'total',
      type: 'formula',
      label: { en: 'Total' },
      formula: { kind: 'round', of: { kind: 'literal', value: 1.2 }, places: 100 },
    })
    const invalidMetric = schemaWithField({
      id: 'metric',
      type: 'metric',
      label: { en: 'Metric' },
      binding: { sourceKey: 'assets', display: 'line' },
    })
    const unboundedDataPage = schemaWithField({
      id: 'records',
      type: 'data_table',
      label: { en: 'Records' },
      binding: { sourceKey: 'assets', limit: 1001 },
    })

    expect(formSchemaV1.safeParse(invalidFormula).success).toBe(false)
    expect(formSchemaV1.safeParse(invalidMetric).success).toBe(false)
    expect(formSchemaV1.safeParse(unboundedDataPage).success).toBe(false)
  })
})
