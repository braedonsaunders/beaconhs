import React from 'react'
import { describe, expect, it } from 'vitest'
import { parseSelectChildren, selectChildrenEqual } from './select-options'

function TransparentValue({ value }: { value: React.ReactNode }) {
  return value
}

describe('Select option parsing', () => {
  it('unwraps translated and conditional option payloads', () => {
    const parsed = parseSelectChildren(
      React.createElement(TransparentValue, {
        value: [
          React.createElement('option', { key: 'placeholder', value: '' }, 'Select…'),
          React.createElement(
            'option',
            { key: 'severity', value: 'severity' },
            React.createElement(TransparentValue, { value: 'Severity' }),
          ),
          React.createElement(
            'optgroup',
            { key: 'site', label: 'Site' },
            React.createElement('option', { value: 'site.name' }, 'Name'),
          ),
        ],
      }),
    )

    expect(parsed).toEqual({
      placeholder: 'Select…',
      emptyLabel: 'Select…',
      clearable: true,
      options: [
        { value: 'severity', label: 'Severity', disabled: false, group: undefined },
        { value: 'site.name', label: 'Name', disabled: false, group: 'Site' },
      ],
    })
  })

  it('compares resolved option sets without forcing render loops', () => {
    const parsed = parseSelectChildren(React.createElement('option', { value: 'active' }, 'Active'))

    expect(selectChildrenEqual(parsed, parsed)).toBe(true)
    expect(
      selectChildrenEqual(parsed, {
        ...parsed,
        options: [{ ...parsed.options[0]!, label: 'Inactive' }],
      }),
    ).toBe(false)
  })
})
