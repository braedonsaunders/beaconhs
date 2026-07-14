import { describe, expect, it } from 'vitest'
import {
  collectionTableBlockHtml,
  mergeFieldBlockHtml,
  safeTemplateKey,
  serializeTemplateEditor,
} from './template-builder-html'

describe('template builder HTML', () => {
  it('accepts real field paths and rejects markup or template syntax', () => {
    expect(safeTemplateKey('inspection.items-2')).toBe('inspection.items-2')
    expect(safeTemplateKey('x"><img src=x onerror=alert(1)>')).toBeNull()
    expect(safeTemplateKey('x}}{{#each evil')).toBeNull()
  })

  it('builds a text-position merge token only for a safe key', () => {
    expect(mergeFieldBlockHtml({ key: 'person.full_name' })).toBe(
      '<span style="color:#0f172a;">{{person.full_name}}</span>',
    )
    expect(mergeFieldBlockHtml({ key: 'x}}<script>alert(1)</script>{{x' })).toBeNull()
  })

  it('serializes GrapesJS structure with its separately authored CSS', () => {
    expect(
      serializeTemplateEditor({
        getHtml: () => '<p id="message">Hello</p>',
        getCss: () => '#message{color:red}',
      }),
    ).toBe('<style>#message{color:red}</style><p id="message">Hello</p>')
    expect(serializeTemplateEditor({ getHtml: () => '<p>Hello</p>' })).toBe('<p>Hello</p>')
  })

  it('escapes tenant-authored table labels and rejects unsafe row keys', () => {
    const html = collectionTableBlockHtml({
      key: 'items',
      label: 'Items',
      fields: [{ key: 'name', label: '<img src=x onerror=alert(1)>' }],
    })
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
    expect(html).toContain('data-each="items"')
    expect(html).toContain('{{name}}')

    expect(
      collectionTableBlockHtml({
        key: 'items" onclick="alert(1)',
        label: 'Items',
        fields: [{ key: 'name', label: 'Name' }],
      }),
    ).toBeNull()
  })
})
