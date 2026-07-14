import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from './schema'
import {
  normalizeFormResponseData,
  normalizeFormResponseDraftData,
  normalizeRichTextLinkUrl,
} from './response-normalize'
import { validateResponse } from './validator'

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Test form' },
  sections: [
    {
      id: 'overview',
      title: { en: 'Overview' },
      fields: [
        { id: 'title', type: 'text', label: { en: 'Title' } },
        { id: 'notes', type: 'rich_text', label: { en: 'Notes' } },
        { id: 'total', type: 'formula', label: { en: 'Total' } },
        { id: 'summary', type: 'metric', label: { en: 'Summary' } },
        {
          id: 'display_table',
          type: 'data_table',
          label: { en: 'Display table' },
          binding: { sourceKey: 'records', selectable: 'none' },
        },
        {
          id: 'selected_rows',
          type: 'data_table',
          label: { en: 'Selected rows' },
          binding: { sourceKey: 'records', selectable: 'multi' },
        },
      ],
    },
    {
      id: 'observations',
      title: { en: 'Observations' },
      repeating: true,
      fields: [
        { id: 'finding', type: 'rich_text', label: { en: 'Finding' } },
        { id: 'owner', type: 'text', label: { en: 'Owner' } },
        { id: 'computed', type: 'formula', label: { en: 'Computed' } },
        { id: 'instructions', type: 'paragraph', label: { en: 'Instructions' } },
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

describe('normalizeFormResponseData', () => {
  it('sanitizes schema-declared top-level and repeating rich text only', () => {
    const source = {
      title: '<script>text fields are not HTML</script>',
      notes:
        '<p onclick="steal()">Safe <strong>formatting</strong></p><script>alert(1)</script><a href="javascript:alert(2)">bad</a><a href="https://example.com" target="_blank">good</a>',
      observations: [
        {
          finding: '<img src="x" onerror="alert(3)"><em>Keep me</em>',
          owner: '<script>still plain data</script>',
          computed: 42,
          instructions: { arbitrary: 'data' },
          unexpectedRowKey: '<script>drop me</script>',
        },
      ],
      unknown: '<script>drop unknown data</script>',
      total: 42,
      summary: { arbitrary: 'data' },
      display_table: ['must-not-persist'],
      selected_rows: ['row-1'],
    }

    const normalized = normalizeFormResponseData(schema, source)

    expect(normalized).not.toBe(source)
    expect(normalized.title).toBe(source.title)
    expect(normalized.unknown).toBeUndefined()
    expect(normalized.total).toBeUndefined()
    expect(normalized.summary).toBeUndefined()
    expect(normalized.display_table).toBeUndefined()
    expect(normalized.selected_rows).toEqual(['row-1'])
    expect(normalized.notes).toBe(
      '<p>Safe <strong>formatting</strong></p><a>bad</a><a href="https://example.com" target="_blank" rel="noopener noreferrer">good</a>',
    )
    expect((normalized.observations as Array<Record<string, unknown>>)[0]).toEqual({
      finding: '<em>Keep me</em>',
      owner: '<script>still plain data</script>',
    })
    expect(source.notes).toContain('<script>')
    expect((source.observations[0] as Record<string, unknown>).finding).toContain('onerror')
  })

  it('is idempotent and returns the original object when no value changes', () => {
    const source = {
      notes: '<p>Already safe</p>',
      observations: [{ finding: '<strong>Safe</strong>', owner: 'Alex' }],
    }
    const first = normalizeFormResponseData(schema, source)
    const second = normalizeFormResponseData(schema, first)

    expect(first).toBe(source)
    expect(second).toBe(first)
  })

  it('normalizes the filler draft row map as well as top-level values', () => {
    const values = {
      notes: '<svg onload="alert(1)"></svg><p>Summary</p>',
      unexpectedValue: 'drop me',
      observations: [{ finding: 'rows belong in the row map' }],
    }
    const rows = {
      observations: [
        {
          finding: '<a href="data:text/html,bad">Finding</a>',
          owner: 'Taylor',
          unexpectedRowKey: 'drop me',
        },
      ],
      unexpectedSection: [{ value: 'drop me' }],
    }

    const normalized = normalizeFormResponseDraftData(schema, values, rows)

    expect(normalized.values.notes).toBe('<p>Summary</p>')
    expect(normalized.values).not.toHaveProperty('unexpectedValue')
    expect(normalized.values).not.toHaveProperty('observations')
    expect(normalized.rows.observations?.[0]).toEqual({
      finding: '<a>Finding</a>',
      owner: 'Taylor',
    })
    expect(normalized.rows).not.toHaveProperty('unexpectedSection')
    expect(values.notes).toContain('onload')
    expect(rows.observations[0]?.finding).toContain('data:')
  })

  it('lets validation reject non-string rich-text values instead of coercing them', () => {
    expect(
      validateResponse(schema, { notes: { html: '<script>alert(1)</script>' } }, 'draft'),
    ).toEqual([{ fieldId: 'notes', sectionId: 'overview', message: 'Must be text' }])
  })

  it('removes executable-only content before required-field validation', () => {
    const requiredSchema: FormSchemaV1 = {
      ...schema,
      sections: schema.sections.map((section) =>
        section.id === 'overview'
          ? {
              ...section,
              fields: section.fields.map((field) =>
                field.id === 'notes' ? { ...field, required: true } : field,
              ),
            }
          : section,
      ),
    }
    const normalized = normalizeFormResponseData(requiredSchema, {
      notes: '<script>alert(1)</script>',
    })

    expect(normalized.notes).toBe('')
    expect(validateResponse(requiredSchema, normalized, 'submit')).toEqual([
      { fieldId: 'notes', sectionId: 'overview', message: 'Required' },
    ])
  })

  it('composes duplicate repeating definitions over previously normalized rows', () => {
    const duplicateDefinitionSchema = {
      ...schema,
      sections: [
        {
          id: 'duplicated',
          repeating: true,
          fields: [{ id: 'first', type: 'rich_text', label: { en: 'First' } }],
        },
        {
          id: 'duplicated',
          repeating: true,
          fields: [{ id: 'second', type: 'rich_text', label: { en: 'Second' } }],
        },
      ],
    } as FormSchemaV1
    const source = {
      duplicated: [
        {
          first: '<p onclick="first()">First</p>',
          second: '<p onclick="second()">Second</p>',
        },
      ],
    }

    expect(normalizeFormResponseData(duplicateDefinitionSchema, source)).toEqual({
      duplicated: [{ first: '<p>First</p>', second: '<p>Second</p>' }],
    })
  })

  it('composes duplicate repeating definitions in the split draft row map', () => {
    const duplicateDefinitionSchema = {
      ...schema,
      sections: [
        {
          id: 'duplicated',
          repeating: true,
          fields: [{ id: 'first', type: 'rich_text', label: { en: 'First' } }],
        },
        {
          id: 'duplicated',
          repeating: true,
          fields: [{ id: 'second', type: 'rich_text', label: { en: 'Second' } }],
        },
      ],
    } as FormSchemaV1
    const rows = {
      duplicated: [
        {
          first: '<p onclick="first()">First</p>',
          second: '<p onclick="second()">Second</p>',
        },
      ],
    }

    expect(normalizeFormResponseDraftData(duplicateDefinitionSchema, {}, rows).rows).toEqual({
      duplicated: [{ first: '<p>First</p>', second: '<p>Second</p>' }],
    })
  })

  it('removes hidden top-level, section, and repeating-row values to a stable fixpoint', () => {
    const conditionalSchema: FormSchemaV1 = {
      schemaVersion: 1,
      title: { en: 'Conditional values' },
      sections: [
        {
          id: 'overview',
          fields: [
            { id: 'trigger', type: 'text', label: { en: 'Trigger' } },
            {
              id: 'controller',
              type: 'text',
              label: { en: 'Controller' },
              showIf: { op: 'eq', field: 'trigger', value: 'show-controller' },
            },
            {
              id: 'dependent',
              type: 'text',
              label: { en: 'Dependent' },
              showIf: { op: 'eq', field: 'controller', value: 'yes' },
            },
          ],
        },
        {
          id: 'hidden_section',
          showIf: { op: 'eq', field: 'trigger', value: 'show-section' },
          fields: [{ id: 'section_secret', type: 'text', label: { en: 'Secret' } }],
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
              showIf: { op: 'eq', field: 'row_controller', value: 'yes' },
            },
          ],
        },
        {
          id: 'hidden_rows',
          repeating: true,
          showIf: { op: 'eq', field: 'trigger', value: 'show-rows' },
          fields: [{ id: 'hidden_row_value', type: 'text', label: { en: 'Hidden row' } }],
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
    const source = {
      trigger: 'hide-everything',
      controller: 'yes',
      dependent: 'ghost value',
      section_secret: 'ghost section value',
      rows: [
        { row_controller: 'no', row_detail: 'ghost row value' },
        { row_controller: 'yes', row_detail: 'keep row value' },
      ],
      hidden_rows: [{ hidden_row_value: 'ghost repeating section' }],
    }

    const normalized = normalizeFormResponseData(conditionalSchema, source)

    expect(normalized).toEqual({
      trigger: 'hide-everything',
      rows: [{ row_controller: 'no' }, { row_controller: 'yes', row_detail: 'keep row value' }],
    })
    expect(normalizeFormResponseData(conditionalSchema, normalized)).toBe(normalized)

    const split = normalizeFormResponseDraftData(
      conditionalSchema,
      {
        trigger: 'hide-everything',
        controller: 'yes',
        dependent: 'ghost value',
        section_secret: 'ghost section value',
      },
      {
        rows: [
          { row_controller: 'no', row_detail: 'ghost row value' },
          { row_controller: 'yes', row_detail: 'keep row value' },
        ],
        hidden_rows: [{ hidden_row_value: 'ghost repeating section' }],
      },
    )
    expect(split).toEqual({
      values: { trigger: 'hide-everything' },
      rows: {
        rows: [{ row_controller: 'no' }, { row_controller: 'yes', row_detail: 'keep row value' }],
      },
    })
  })
})

describe('normalizeRichTextLinkUrl', () => {
  it.each([
    ['https://example.com/path', 'https://example.com/path'],
    ['mailto:safety@example.com', 'mailto:safety@example.com'],
    ['tel:+15551234567', 'tel:+15551234567'],
    ['/apps/responses/123', '/apps/responses/123'],
    ['#finding', '#finding'],
  ])('accepts safe link %s', (input, expected) => {
    expect(normalizeRichTextLinkUrl(input)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)',
    'http://example.com',
    'https:example.com',
    'https://user:pass@example.com',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/path',
    'relative/path',
    'https://example.com/\nheader',
    '',
  ])('rejects unsafe or ambiguous link %s', (input) => {
    expect(normalizeRichTextLinkUrl(input)).toBeNull()
  })
})
