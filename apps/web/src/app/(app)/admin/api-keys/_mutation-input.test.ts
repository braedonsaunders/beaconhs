import { describe, expect, it } from 'vitest'
import {
  readApiKeyExpiresAt,
  readApiKeyId,
  readApiKeyName,
  readApiKeyPermissions,
  readBuilderTemplateGrantIds,
} from './_mutation-input'

const KEY_ID = '10000000-0000-4000-8000-000000000001'
const TEMPLATE_ID = '20000000-0000-4000-8000-000000000001'

describe('API key mutation input', () => {
  it('normalizes bounded names and validates key ids', () => {
    const form = new FormData()
    form.set('id', KEY_ID)
    form.set('name', '  Payroll integration  ')
    expect(readApiKeyId(form)).toBe(KEY_ID)
    expect(readApiKeyName(form)).toBe('Payroll integration')
    form.set('name', 'x'.repeat(201))
    expect(() => readApiKeyName(form)).toThrow(/too long/)
    form.set('id', 'invalid')
    expect(() => readApiKeyId(form)).toThrow(/API key is invalid/)
  })

  it('rejects unknown permissions instead of silently dropping them', () => {
    const form = new FormData()
    form.append('permissions', 'training.read.all')
    form.append('permissions', 'incidents.read.all')
    expect(readApiKeyPermissions(form)).toEqual(['incidents.read.all', 'training.read.all'])
    form.append('permissions', 'platform.root')
    expect(() => readApiKeyPermissions(form)).toThrow(/permissions are invalid/)
  })

  it('strictly validates and de-duplicates Builder grants', () => {
    const form = new FormData()
    form.append('builderTemplateIds', TEMPLATE_ID)
    form.append('builderTemplateIds', TEMPLATE_ID)
    expect(readBuilderTemplateGrantIds(form)).toEqual([TEMPLATE_ID])
    form.append('builderTemplateIds', 'not-a-uuid')
    expect(() => readBuilderTemplateGrantIds(form)).toThrow(/Builder app grant is invalid/)
  })

  it('parses a real future date at the exact end of UTC day', () => {
    const form = new FormData()
    const now = new Date('2026-07-13T12:00:00Z')
    expect(readApiKeyExpiresAt(form, now)).toBeNull()
    form.set('expiresAt', '2026-07-13')
    expect(readApiKeyExpiresAt(form, now)?.toISOString()).toBe('2026-07-13T23:59:59.999Z')
    form.set('expiresAt', '2026-07-12')
    expect(() => readApiKeyExpiresAt(form, now)).toThrow(/today or later/)
    form.set('expiresAt', '2026-02-29')
    expect(() => readApiKeyExpiresAt(form, now)).toThrow(/invalid/)
  })
})
