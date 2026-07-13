import { describe, expect, it } from 'vitest'
import { validateStoredEmailConfig, type RawEmailConfig } from '@beaconhs/emails'
import {
  assertTenantEmailOverrideAllowed,
  describeEmailConfigChange,
  mergeEmailConfig,
  toEmailSettings,
  validateEmailConfigForSave,
  type EmailSettingsInput,
} from './email-config'

const input: EmailSettingsInput = {
  enabled: true,
  provider: 'sendgrid',
  fromName: 'BeaconHS',
  fromEmail: 'beacon@example.com',
  replyTo: 'safety@example.com',
  mailgunDomain: '',
  mailgunRegion: 'us',
  smtpHost: '',
  smtpPort: 0,
  smtpSecure: false,
  smtpUsername: '',
}

describe('email provider configuration', () => {
  it('renders an absent tenant override as disabled', () => {
    expect(toEmailSettings({})).toMatchObject({
      enabled: false,
      provider: 'resend',
      hasKey: false,
    })
  })

  it('does not treat a legacy provider with no explicit enabled flag as active', () => {
    expect(toEmailSettings({ provider: 'sendgrid' }).enabled).toBe(false)
    expect(toEmailSettings({ provider: 'sendgrid', enabled: true }).enabled).toBe(true)
  })

  it('permits tenant mutations only under the tenant-optional platform policy', () => {
    expect(() => assertTenantEmailOverrideAllowed({ mode: 'tenant_optional' })).not.toThrow()
    expect(() => assertTenantEmailOverrideAllowed({ mode: 'global_only' })).toThrow(
      'Tenant email provider overrides are unavailable',
    )
    expect(() => assertTenantEmailOverrideAllowed({ mode: 'disabled' })).toThrow(
      'Tenant email provider overrides are unavailable',
    )
  })

  it('retains a sealed credential only while the provider is unchanged', () => {
    const previous: RawEmailConfig = {
      provider: 'sendgrid',
      keyCiphertext: 'sendgrid-ciphertext',
      keyNonce: 'sendgrid-nonce',
    }

    expect(mergeEmailConfig(previous, input)).toMatchObject({
      provider: 'sendgrid',
      keyCiphertext: 'sendgrid-ciphertext',
      keyNonce: 'sendgrid-nonce',
    })

    const switched = mergeEmailConfig(previous, {
      ...input,
      enabled: false,
      provider: 'postmark',
    })
    expect(switched.keyCiphertext).toBeUndefined()
    expect(switched.keyNonce).toBeUndefined()
  })

  it('requires a new credential when an enabled configuration changes providers', () => {
    const switched = mergeEmailConfig(
      {
        provider: 'resend',
        keyCiphertext: 'resend-ciphertext',
        keyNonce: 'resend-nonce',
      },
      input,
    )

    expect(() => validateStoredEmailConfig(switched)).toThrow(
      "Enter this provider's credential before enabling email delivery.",
    )
  })

  it('reports credential removal when a disabled provider switch supplies no replacement', () => {
    const previous: RawEmailConfig = {
      enabled: true,
      provider: 'resend',
      keyCiphertext: 'resend-ciphertext',
      keyNonce: 'resend-nonce',
    }
    const next = mergeEmailConfig(previous, {
      ...input,
      enabled: false,
      provider: 'postmark',
    })

    expect(describeEmailConfigChange(previous, next, false)).toEqual({
      previousProvider: 'resend',
      providerChanged: true,
      credentialChange: 'removed',
      enabledChanged: true,
    })
  })

  it('requires a live saved credential to decrypt into a usable transport', () => {
    expect(() =>
      validateEmailConfigForSave(
        {
          enabled: true,
          provider: 'sendgrid',
          fromEmail: 'beacon@example.com',
          keyCiphertext: 'structurally-present-but-corrupt',
          keyNonce: 'also-corrupt',
        },
        true,
      ),
    ).toThrow('could not be decrypted')

    expect(() =>
      validateEmailConfigForSave(
        {
          enabled: true,
          provider: 'smtp',
          fromEmail: 'beacon@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
        },
        true,
      ),
    ).not.toThrow()
  })

  it('still validates fields while saving a disabled draft', () => {
    expect(() =>
      validateEmailConfigForSave(
        {
          enabled: false,
          provider: 'smtp',
          smtpHost: 'https://smtp.example.com',
        },
        false,
      ),
    ).toThrow('Enter a valid SMTP host')
  })

  it('validates provider-specific fields before an enabled config is stored', () => {
    expect(() =>
      validateStoredEmailConfig({
        enabled: true,
        provider: 'mailgun',
        fromEmail: 'beacon@example.com',
        mailgunDomain: 'https://mg.example.com',
        keyCiphertext: 'ciphertext',
        keyNonce: 'nonce',
      }),
    ).toThrow('Enter a valid Mailgun sending domain')

    expect(() =>
      validateStoredEmailConfig({
        enabled: true,
        provider: 'smtp',
        fromEmail: 'beacon@example.com',
        smtpHost: 'smtp://mail.example.com',
        smtpPort: 587,
      }),
    ).toThrow('Enter a valid SMTP host')

    expect(() =>
      validateStoredEmailConfig({
        enabled: true,
        provider: 'smtp',
        fromEmail: 'beacon@example.com',
        smtpHost: 'mail.example.com',
        smtpPort: 70_000,
      }),
    ).toThrow('SMTP port must be a whole number')
  })

  it('validates sender addresses and permits incomplete disabled drafts', () => {
    expect(() =>
      validateStoredEmailConfig({
        enabled: true,
        provider: 'sendgrid',
        fromEmail: 'not-an-email',
        keyCiphertext: 'ciphertext',
        keyNonce: 'nonce',
      }),
    ).toThrow('Enter a valid From email address')

    expect(() =>
      validateStoredEmailConfig({
        enabled: true,
        provider: 'sendgrid',
        fromEmail: 'beacon@example.com',
        replyTo: 'not-an-email',
        keyCiphertext: 'ciphertext',
        keyNonce: 'nonce',
      }),
    ).toThrow('Enter a valid Reply-to email address')

    expect(() => validateStoredEmailConfig({ enabled: false, provider: 'sendgrid' })).not.toThrow()

    expect(() =>
      validateStoredEmailConfig({
        enabled: false,
        provider: 'sendgrid',
        fromName: 'BeaconHS <alerts>',
      }),
    ).toThrow('cannot contain angle brackets')

    expect(() =>
      validateStoredEmailConfig({
        enabled: false,
        provider: 'smtp',
        smtpPort: Number.NaN,
      }),
    ).toThrow('SMTP port must be a whole number')
  })
})
