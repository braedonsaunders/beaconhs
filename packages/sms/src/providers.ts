// SMS provider catalogue — the single source of truth for the settings UI and
// the transport factory. Add a provider here (+ a `sendSmsVia` branch) and it
// lights up in the admin form. This module is pure data (no SDK / Node imports)
// so it is safe to map into the client bundle.
//
// Every provider authenticates over HTTPS with a single sealed secret (auth
// token / api secret / api key / access key) plus, for some, one non-secret
// identifier (account SID / API key / auth ID). The universal "sender" (a
// phone number or alphanumeric sender ID) is collected once by the form.

export type SmsProvider = 'twilio' | 'vonage' | 'messagebird' | 'plivo' | 'telnyx'

export type SmsFieldKind = 'text' | 'number' | 'boolean' | 'select'

// A non-secret config input a provider needs, beyond the universal sender.
// `key` is both the form field name and the RawSmsConfig key it persists to.
export type SmsProviderField = {
  key: string
  kind: SmsFieldKind
  label: string
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]
  help?: string
}

export type SmsProviderSpec = {
  value: SmsProvider
  label: string
  /** Whether this provider authenticates with a single sealed secret. */
  hasSecret: boolean
  /** Label for the single sealed secret (auth token / api secret / key). */
  secretLabel: string
  /** Placeholder shown in the secret field. */
  keyHint: string
  /** Whether the secret is mandatory. */
  secretRequired: boolean
  /** Extra non-secret config fields this provider needs. */
  fields: SmsProviderField[]
  /** Optional note shown under the provider picker. */
  docsHint?: string
}

export const SMS_PROVIDER_SPECS: SmsProviderSpec[] = [
  {
    value: 'twilio',
    label: 'Twilio',
    hasSecret: true,
    secretLabel: 'Auth token',
    keyHint: 'Your Twilio auth token',
    secretRequired: true,
    fields: [
      {
        key: 'twilioAccountSid',
        kind: 'text',
        label: 'Account SID',
        placeholder: 'AC…',
        required: true,
      },
    ],
    docsHint:
      'Account SID and Auth token are in the Twilio Console. The sender is your Twilio number (E.164) or a Messaging Service SID.',
  },
  {
    value: 'vonage',
    label: 'Vonage',
    hasSecret: true,
    secretLabel: 'API secret',
    keyHint: 'Your Vonage API secret',
    secretRequired: true,
    fields: [
      {
        key: 'vonageApiKey',
        kind: 'text',
        label: 'API key',
        placeholder: 'Your Vonage API key',
        required: true,
      },
    ],
    docsHint:
      'API key + secret are on the Vonage dashboard home. The sender may be a number or brand name.',
  },
  {
    value: 'messagebird',
    label: 'MessageBird (Bird)',
    hasSecret: true,
    secretLabel: 'Access key',
    keyHint: 'Your live access key',
    secretRequired: true,
    fields: [],
    docsHint: 'Use a live access key from the Bird dashboard (Developers → API access).',
  },
  {
    value: 'plivo',
    label: 'Plivo',
    hasSecret: true,
    secretLabel: 'Auth token',
    keyHint: 'Your Plivo auth token',
    secretRequired: true,
    fields: [
      {
        key: 'plivoAuthId',
        kind: 'text',
        label: 'Auth ID',
        placeholder: 'MA… / SA…',
        required: true,
      },
    ],
    docsHint:
      'Auth ID + token are on the Plivo Console overview. The sender is a Plivo number or Powerpack.',
  },
  {
    value: 'telnyx',
    label: 'Telnyx',
    hasSecret: true,
    secretLabel: 'API key',
    keyHint: 'KEY…',
    secretRequired: true,
    fields: [
      {
        key: 'telnyxMessagingProfileId',
        kind: 'text',
        label: 'Messaging profile ID',
        placeholder: 'Optional — required for alphanumeric senders',
      },
    ],
    docsHint:
      'Create a V2 API key in the Telnyx portal. The sender is a number on your messaging profile.',
  },
]

const SPEC_BY_VALUE = Object.fromEntries(SMS_PROVIDER_SPECS.map((s) => [s.value, s])) as Record<
  SmsProvider,
  SmsProviderSpec
>

export function isSmsProvider(value: unknown): value is SmsProvider {
  return typeof value === 'string' && Object.hasOwn(SPEC_BY_VALUE, value)
}

export function smsProviderSpec(provider: SmsProvider): SmsProviderSpec {
  return SPEC_BY_VALUE[provider]
}
