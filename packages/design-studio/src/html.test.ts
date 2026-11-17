import { describe, expect, it } from 'vitest'
import { valueForField } from './html'

const credential = {
  tenantName: 'Beacon Health & Safety',
  recipientFullName: 'Avery Chen',
  credentialName: 'Confined Space Entry and Monitor',
  credentialCode: 'CSE-201',
}

describe('credential data fields', () => {
  it('prints the course or skill description, blank when there is none', () => {
    expect(
      valueForField('credential.description', {
        ...credential,
        credentialDescription: 'Entry and rescue planning for confined spaces.',
      }),
    ).toBe('Entry and rescue planning for confined spaces.')
    expect(valueForField('credential.description', credential)).toBe('')
  })
})
