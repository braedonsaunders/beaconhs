import { describe, expect, it } from 'vitest'
import { validateStoredSmsConfig, type RawSmsConfig } from '@beaconhs/sms'
import {
  assertTenantSmsOverrideAllowed,
  describeSmsConfigChange,
  mergeSmsConfig,
  toSmsSettings,
  validateSmsConfigForSave,
  type SmsSettingsInput,
} from './sms-config'

const input: SmsSettingsInput = {
  enabled: true,
  provider: 'messagebird',
  fromNumber: 'BeaconHS',
  twilioAccountSid: '',
  vonageApiKey: '',
  plivoAuthId: '',
  telnyxMessagingProfileId: '',
}

describe('SMS provider configuration', () => {
  it('renders an absent or implicit tenant override as disabled', () => {
    expect(toSmsSettings({})).toMatchObject({ enabled: false, provider: 'twilio', hasKey: false })
    expect(toSmsSettings({ provider: 'messagebird' }).enabled).toBe(false)
    expect(toSmsSettings({ provider: 'messagebird', enabled: true }).enabled).toBe(true)
  })

  it('permits tenant mutations only under the tenant-optional platform policy', () => {
    expect(() => assertTenantSmsOverrideAllowed({ mode: 'tenant_optional' })).not.toThrow()
    expect(() => assertTenantSmsOverrideAllowed({ mode: 'global_only' })).toThrow(
      'Tenant SMS provider overrides are unavailable',
    )
    expect(() => assertTenantSmsOverrideAllowed({ mode: 'disabled' })).toThrow(
      'Tenant SMS provider overrides are unavailable',
    )
  })

  it('retains a sealed credential only while the provider is unchanged', () => {
    const previous: RawSmsConfig = {
      provider: 'messagebird',
      keyCiphertext: 'messagebird-ciphertext',
      keyNonce: 'messagebird-nonce',
    }
    expect(mergeSmsConfig(previous, input)).toMatchObject({
      provider: 'messagebird',
      keyCiphertext: 'messagebird-ciphertext',
      keyNonce: 'messagebird-nonce',
    })

    const switched = mergeSmsConfig(previous, {
      ...input,
      enabled: false,
      provider: 'telnyx',
    })
    expect(switched.keyCiphertext).toBeUndefined()
    expect(switched.keyNonce).toBeUndefined()
  })

  it('requires a new credential when an enabled configuration changes providers', () => {
    const switched = mergeSmsConfig(
      {
        provider: 'twilio',
        keyCiphertext: 'twilio-ciphertext',
        keyNonce: 'twilio-nonce',
      },
      input,
    )
    expect(() => validateStoredSmsConfig(switched)).toThrow(
      "Enter this provider's credential before enabling SMS delivery.",
    )
  })

  it('reports credential removal without putting credential material in audit metadata', () => {
    const previous: RawSmsConfig = {
      enabled: true,
      provider: 'twilio',
      fromNumber: '+15551234567',
      twilioAccountSid: 'AC-account',
      keyCiphertext: 'twilio-ciphertext',
      keyNonce: 'twilio-nonce',
    }
    const next = mergeSmsConfig(previous, {
      ...input,
      enabled: false,
      provider: 'messagebird',
    })
    expect(describeSmsConfigChange(previous, next, false)).toEqual({
      previousProvider: 'twilio',
      providerChanged: true,
      credentialChange: 'removed',
      enabledChanged: true,
    })
  })

  it('requires an enabled saved credential to decrypt into a usable transport', () => {
    expect(() =>
      validateSmsConfigForSave(
        {
          enabled: true,
          provider: 'messagebird',
          fromNumber: 'BeaconHS',
          keyCiphertext: 'structurally-present-but-corrupt',
          keyNonce: 'also-corrupt',
        },
        true,
      ),
    ).toThrow('could not be decrypted')
  })

  it('validates incomplete live providers and unsafe disabled drafts', () => {
    expect(() =>
      validateStoredSmsConfig({
        enabled: true,
        provider: 'twilio',
        fromNumber: '+15551234567',
        keyCiphertext: 'ciphertext',
        keyNonce: 'nonce',
      }),
    ).toThrow('Twilio account SID')
    expect(() =>
      validateSmsConfigForSave(
        { enabled: false, provider: 'messagebird', fromNumber: 'BeaconHS\nInjected' },
        false,
      ),
    ).toThrow('SMS sender')
  })
})
