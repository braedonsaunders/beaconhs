import { expect, it } from 'vitest'
import { rewriteXmlElements, xmlElements } from './xml-elements'

it('preserves document declarations, quoted delimiters, entities and UTF-16 offsets', () => {
  const xml =
    '<?xml version="1.0"?><root>😀<!-- <w:r>fake</w:r> --><w:r a=">">One &amp; two</w:r><w:r/></root>'
  expect(xmlElements(xml, 'w:r')).toEqual(['<w:r a=">">One &amp; two</w:r>', '<w:r/>'])
  expect(rewriteXmlElements(xml, 'w:r', (run) => run.replace('One', 'Three'))).toBe(
    xml.replace('One', 'Three'),
  )
})
it('matches complete balanced outer elements, not the first nested closing tag', () => {
  const xml = '<w:tbl><w:tbl><w:tc/></w:tbl></w:tbl><w:tbl/>'
  expect(xmlElements(xml, 'w:tbl')).toEqual(['<w:tbl><w:tbl><w:tc/></w:tbl></w:tbl>', '<w:tbl/>'])
})
it('rejects many unmatched opening tags without retrying from each opener', () => {
  expect(() => xmlElements('<w:rPr>'.repeat(20_000), 'w:rPr')).toThrow()
})
it('handles deeply balanced elements without recursive regular-expression matching', () => {
  const xml = '<w:tbl>'.repeat(10_000) + '</w:tbl>'.repeat(10_000)
  expect(xmlElements(xml, 'w:tbl')).toEqual([xml])
})
