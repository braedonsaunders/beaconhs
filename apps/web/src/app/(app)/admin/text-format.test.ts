import { describe, expect, it } from 'vitest'
import { colorToHex, isFormattable, readTextFormat, textFormatPatch } from './_text-format'

const computed = (overrides: Partial<Record<string, string>> = {}) => ({
  fontWeight: '400',
  fontStyle: 'normal',
  textDecorationLine: 'none',
  fontSize: '13px',
  color: 'rgb(15, 23, 42)',
  textAlign: 'start',
  display: 'block',
  ...overrides,
})

const component = (attrs: Record<string, unknown>) => ({ get: (name: string) => attrs[name] })

describe('text format', () => {
  it('reads inherited formatting from the computed style', () => {
    expect(readTextFormat(computed({ fontWeight: '700', display: 'table-cell' }))).toEqual({
      bold: true,
      italic: false,
      underline: false,
      fontSizePx: 13,
      color: '#0f172a',
      align: 'left',
      block: true,
    })
    const value = readTextFormat(
      computed({
        fontWeight: 'bold',
        fontStyle: 'italic',
        textDecorationLine: 'underline line-through',
        fontSize: '11.5px',
        textAlign: 'right',
        display: 'inline',
      }),
    )
    expect(value).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      fontSizePx: 11.5,
      align: 'right',
      block: false,
    })
  })

  it('converts colours to #rrggbb', () => {
    expect(colorToHex('rgb(255, 0, 128)')).toBe('#ff0080')
    expect(colorToHex('rgba(0, 0, 0, 0.5)')).toBe('#000000')
    expect(colorToHex('#ABC')).toBe('#aabbcc')
    expect(colorToHex('#0f172a')).toBe('#0f172a')
  })

  it('writes only the changed properties and keeps the rest', () => {
    const current = readTextFormat(computed())
    const own = { padding: '4px', color: '#334155' }
    expect(textFormatPatch(own, current, { bold: true })).toEqual({
      padding: '4px',
      color: '#334155',
      'font-weight': '700',
    })
    expect(textFormatPatch(own, current, { italic: false, underline: true })).toEqual({
      padding: '4px',
      color: '#334155',
      'font-style': 'normal',
      'text-decoration': 'underline',
    })
    expect(textFormatPatch(own, current, { align: 'center', color: '#FF0000' })).toEqual({
      padding: '4px',
      color: '#ff0000',
      'text-align': 'center',
    })
  })

  it('clamps sizes, ignores unchanged sizes and rejects invalid colours', () => {
    const current = readTextFormat(computed())
    expect(textFormatPatch({}, current, { fontSizePx: 200 })).toEqual({ 'font-size': '96px' })
    expect(textFormatPatch({}, current, { fontSizePx: 13 })).toEqual({})
    expect(textFormatPatch({}, current, { color: 'red;background:url(x)' })).toEqual({})
  })

  it('formats text-bearing components, not table structure or media', () => {
    expect(isFormattable(component({ type: 'record-value', tagName: 'span' }))).toBe(true)
    expect(isFormattable(component({ type: 'cell', tagName: 'td' }))).toBe(true)
    expect(isFormattable(component({ type: 'text', tagName: 'h2' }))).toBe(true)
    expect(isFormattable(component({ type: 'default', tagName: 'tr' }))).toBe(false)
    expect(isFormattable(component({ type: 'image', tagName: 'img' }))).toBe(false)
    expect(isFormattable(component({ type: 'wrapper', tagName: 'body' }))).toBe(false)
    expect(isFormattable(component({ type: 'text', tagName: 'p', stylable: false }))).toBe(false)
  })
})
