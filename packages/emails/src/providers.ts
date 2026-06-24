// Email provider catalogue — the single source of truth for the settings UI and
// the transport factory. Add a provider here (+ a `sendVia` branch) and it lights
// up in the admin form. This module is pure data (no SDK / Node imports) so it is
// safe to map into the client bundle.

export type EmailProvider = 'resend' | 'sendgrid' | 'mailgun' | 'postmark' | 'smtp'

export type EmailFieldKind = 'text' | 'number' | 'boolean' | 'select'

// A non-secret config input a provider needs, beyond the universal
// sender (from name/email) + reply-to. `key` is both the form field name and the
// RawEmailConfig key it persists to.
export type EmailProviderField = {
  key: string
  kind: EmailFieldKind
  label: string
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]
  help?: string
}

export type EmailProviderSpec = {
  value: EmailProvider
  label: string
  /** HTTP API (fetch) vs SMTP (nodemailer). */
  transport: 'http' | 'smtp'
  /** Whether this provider authenticates with a single sealed secret. */
  hasSecret: boolean
  /** Label for the single sealed secret (api key / server token / password). */
  secretLabel: string
  /** Placeholder shown in the secret field. */
  keyHint: string
  /** Whether the secret is mandatory (SMTP can be open-relay / Mailpit). */
  secretRequired: boolean
  /** Extra non-secret config fields this provider needs. */
  fields: EmailProviderField[]
  /** Optional note shown under the provider picker. */
  docsHint?: string
}

export const EMAIL_PROVIDER_SPECS: EmailProviderSpec[] = [
  {
    value: 'resend',
    label: 'Resend',
    transport: 'http',
    hasSecret: true,
    secretLabel: 'API key',
    keyHint: 're_…',
    secretRequired: true,
    fields: [],
  },
  {
    value: 'sendgrid',
    label: 'SendGrid',
    transport: 'http',
    hasSecret: true,
    secretLabel: 'API key',
    keyHint: 'SG.…',
    secretRequired: true,
    fields: [],
  },
  {
    value: 'mailgun',
    label: 'Mailgun',
    transport: 'http',
    hasSecret: true,
    secretLabel: 'API key',
    keyHint: 'Your Mailgun sending key',
    secretRequired: true,
    fields: [
      {
        key: 'mailgunDomain',
        kind: 'text',
        label: 'Sending domain',
        placeholder: 'mg.yourcompany.com',
        required: true,
      },
      {
        key: 'mailgunRegion',
        kind: 'select',
        label: 'Region',
        options: [
          { value: 'us', label: 'US' },
          { value: 'eu', label: 'EU' },
        ],
      },
    ],
  },
  {
    value: 'postmark',
    label: 'Postmark',
    transport: 'http',
    hasSecret: true,
    secretLabel: 'Server token',
    keyHint: 'Your Postmark server token',
    secretRequired: true,
    fields: [],
  },
  {
    value: 'smtp',
    label: 'SMTP (custom)',
    transport: 'smtp',
    hasSecret: true,
    secretLabel: 'Password',
    keyHint: 'SMTP password (leave blank for an unauthenticated relay)',
    secretRequired: false,
    fields: [
      {
        key: 'smtpHost',
        kind: 'text',
        label: 'Host',
        placeholder: 'smtp.yourprovider.com',
        required: true,
      },
      { key: 'smtpPort', kind: 'number', label: 'Port', placeholder: '587' },
      { key: 'smtpSecure', kind: 'boolean', label: 'Use implicit TLS (port 465)' },
      { key: 'smtpUsername', kind: 'text', label: 'Username', placeholder: 'apikey or full email' },
    ],
    docsHint:
      'Works with AWS SES, Microsoft 365, Google Workspace and any self-hosted server via SMTP credentials.',
  },
]

const SPEC_BY_VALUE = Object.fromEntries(EMAIL_PROVIDER_SPECS.map((s) => [s.value, s])) as Record<
  EmailProvider,
  EmailProviderSpec
>

export function isEmailProvider(value: unknown): value is EmailProvider {
  return typeof value === 'string' && value in SPEC_BY_VALUE
}

export function emailProviderSpec(provider: EmailProvider): EmailProviderSpec {
  return SPEC_BY_VALUE[provider]
}
