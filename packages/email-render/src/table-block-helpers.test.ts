import { describe, expect, it } from 'vitest'
import { findTableStructureBlockHelpers } from './index'

describe('findTableStructureBlockHelpers', () => {
  it('finds block helpers written between table cells or rows', () => {
    const rowBranches =
      '<table><tbody><tr data-each="entries">{{#if is_weekend}}<td>a</td>{{else}}<td>b</td>{{/if}}</tr></tbody></table>'
    expect(findTableStructureBlockHelpers(rowBranches)).toEqual([
      '{{#if is_weekend}}',
      '{{else}}',
      '{{/if}}',
    ])
    expect(
      findTableStructureBlockHelpers('<table>{{#each rows}}<tr><td>x</td></tr>{{/each}}</table>'),
    ).toEqual(['{{#each rows}}', '{{/each}}'])
  })

  it('accepts helpers inside cells, around whole tables, and data-if / data-each rows', () => {
    expect(
      findTableStructureBlockHelpers(
        '{{#if a}}<table><tr data-if="b"><td>{{#if c}}yes{{else}}no{{/if}} {{value}}</td></tr></table>{{else}}<p>none</p>{{/if}}',
      ),
    ).toEqual([])
  })
})
