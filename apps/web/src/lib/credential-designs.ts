export type CredentialFormat = 'letter-landscape' | 'letter-portrait' | 'wallet'
export type CredentialTemplateId = 'sovereign-seal' | 'field-pass' | 'clean-authority'
export type CredentialTypeface = 'classic' | 'modern' | 'technical'

export type CredentialDesign = {
  name: string
  format: CredentialFormat
  templateId: CredentialTemplateId
  primary: string
  accent: string
  paper: string
  typeface: CredentialTypeface
  patternStrength: number
  showPhoto: boolean
  showQr: boolean
  showSeal: boolean
}

export const CREDENTIAL_DESIGN_SETTINGS_KEY = 'trainingCredentialDesign'

export const DEFAULT_CREDENTIAL_DESIGN: CredentialDesign = {
  name: 'Default training credential',
  format: 'letter-landscape',
  templateId: 'sovereign-seal',
  primary: '#18385f',
  accent: '#b8892f',
  paper: '#fdf9ef',
  typeface: 'classic',
  patternStrength: 56,
  showPhoto: true,
  showQr: true,
  showSeal: true,
}

const formats: CredentialFormat[] = ['letter-landscape', 'letter-portrait', 'wallet']
const templates: CredentialTemplateId[] = ['sovereign-seal', 'field-pass', 'clean-authority']
const typefaces: CredentialTypeface[] = ['classic', 'modern', 'technical']
const hex = /^#[0-9a-fA-F]{6}$/

export function normalizeCredentialDesign(input: unknown): CredentialDesign {
  const raw = input && typeof input === 'object' ? (input as Partial<CredentialDesign>) : {}
  return {
    ...DEFAULT_CREDENTIAL_DESIGN,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 120)
        : DEFAULT_CREDENTIAL_DESIGN.name,
    format: formats.includes(raw.format as CredentialFormat)
      ? (raw.format as CredentialFormat)
      : DEFAULT_CREDENTIAL_DESIGN.format,
    templateId: templates.includes(raw.templateId as CredentialTemplateId)
      ? (raw.templateId as CredentialTemplateId)
      : DEFAULT_CREDENTIAL_DESIGN.templateId,
    primary:
      typeof raw.primary === 'string' && hex.test(raw.primary)
        ? raw.primary
        : DEFAULT_CREDENTIAL_DESIGN.primary,
    accent:
      typeof raw.accent === 'string' && hex.test(raw.accent)
        ? raw.accent
        : DEFAULT_CREDENTIAL_DESIGN.accent,
    paper:
      typeof raw.paper === 'string' && hex.test(raw.paper)
        ? raw.paper
        : DEFAULT_CREDENTIAL_DESIGN.paper,
    typeface: typefaces.includes(raw.typeface as CredentialTypeface)
      ? (raw.typeface as CredentialTypeface)
      : DEFAULT_CREDENTIAL_DESIGN.typeface,
    patternStrength:
      typeof raw.patternStrength === 'number'
        ? Math.max(0, Math.min(80, Math.round(raw.patternStrength)))
        : DEFAULT_CREDENTIAL_DESIGN.patternStrength,
    showPhoto:
      typeof raw.showPhoto === 'boolean' ? raw.showPhoto : DEFAULT_CREDENTIAL_DESIGN.showPhoto,
    showQr: typeof raw.showQr === 'boolean' ? raw.showQr : DEFAULT_CREDENTIAL_DESIGN.showQr,
    showSeal: typeof raw.showSeal === 'boolean' ? raw.showSeal : DEFAULT_CREDENTIAL_DESIGN.showSeal,
  }
}
