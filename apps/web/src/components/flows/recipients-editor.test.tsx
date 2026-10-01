import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { EmailTarget } from '@beaconhs/forms-core'
import type { RecipientOptions } from '../../lib/flows/recipient-presentation'
vi.mock('@/i18n/generated-key', () => import('../../i18n/generated-key'))
vi.mock('@/i18n/generated', async () => {
  const { default: messages } = await import('../../../../../packages/i18n/src/messages/en.json')
  return {
    GeneratedValue: ({ value }: { value: ReactNode }) => value,
    GeneratedText: ({ id }: { id: string }) => id,
    useGeneratedTranslations:
      () =>
      (key: keyof typeof messages.Generated, values: Record<string, string> = {}) =>
        (messages.Generated[key] ?? key).replace(
          /\{value\d+\}/g,
          (token) => values[token.slice(1, -1)] ?? token,
        ),
    useGeneratedValueTranslations: () => (value: string) => value,
  }
})
vi.mock(
  '@/lib/flows/recipient-presentation',
  () => import('../../lib/flows/recipient-presentation'),
)
import { RecipientsEditor } from './recipients-editor'
const contacts = Array.from({ length: 21 }, (_, i) => ({
  id: `contact-${i}`,
  name: `Client ${i}`,
  email: `client${i}@example.com`,
  orgUnitName: `Site ${i}`,
}))
const options: RecipientOptions = {
  people: [{ id: 'worker', name: 'Always worker' }],
  contacts,
  roles: [],
  departments: [],
  personGroups: [],
  obligations: [],
  spreadsheetTemplates: [],
}
function render(to: EmailTarget[], readOnly = false) {
  return renderToStaticMarkup(
    <RecipientsEditor
      to={to}
      options={options}
      readOnly={readOnly}
      fieldIds={['location_key']}
      availableFields={[{ id: 'location_key', label: 'Location' }]}
      onChange={() => {
        throw new Error('Rendering must not change recipients')
      }}
    />,
  )
}
describe('shared recipient editor', () => {
  it('separates always included recipients from location rules and bounds long lists', () => {
    const html = render([
      { type: 'person', personId: 'worker' },
      ...contacts.map((contact): EmailTarget => ({
        type: 'org_unit_contact',
        contactId: contact.id,
        orgUnitField: 'location_key',
      })),
    ])
    expect(html).toContain('Always included')
    expect(html).toContain('Conditional recipients')
    expect(html).toContain('(21)')
    expect(html.match(/<details /g)).toHaveLength(11)
    expect(html).toContain('Location = Site 0')
    expect(html).toContain('Search recipients or conditions')
    expect(html).toContain('1 / 3')
    expect(html).toContain('value="location_key" selected="">Location</option>')
    expect(html).not.toContain('value="Location"')
  })
  it('shows genuine empty state and keeps read-only editing disabled', () => {
    const empty = render([], true)
    expect(empty).not.toContain('<details ')
    expect(empty).not.toContain('The submitter')
    expect(empty).toContain('No recipients in this group.')
    const readOnly = render([{ type: 'person', personId: 'worker' }], true)
    expect(readOnly).toContain('disabled=""')
    expect(readOnly).not.toContain('Add recipient')
    expect(readOnly).not.toContain('m_0d9b2e08c28452')
  })
})
