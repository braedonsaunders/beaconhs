import {
  createCertificateDesignDocument,
  createWalletDesignDocument,
  normalizeDesignDocument,
  type DesignDocument,
} from '@beaconhs/design-studio'

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
  document?: DesignDocument
}

export type CredentialOutput = CredentialDesign & {
  id: string
  description: string
  enabled: boolean
}

export const CREDENTIAL_DESIGN_SETTINGS_KEY = 'trainingCredentialDesign'
export const CREDENTIAL_OUTPUTS_SETTINGS_KEY = 'trainingCredentialOutputs'

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

export const DEFAULT_CREDENTIAL_OUTPUTS: CredentialOutput[] = [
  {
    ...DEFAULT_CREDENTIAL_DESIGN,
    id: 'certificate',
    name: 'Full-size certificate',
    description: 'Letter PDF for personnel files, wall display, and compliance packages.',
    format: 'letter-landscape',
    templateId: 'sovereign-seal',
    document: createCertificateDesignDocument(DEFAULT_CREDENTIAL_DESIGN),
    enabled: true,
  },
  {
    ...DEFAULT_CREDENTIAL_DESIGN,
    id: 'wallet-card',
    name: 'Wallet card',
    description: 'Two-sided CR80 card for field verification and mobile crews.',
    format: 'wallet',
    templateId: 'field-pass',
    primary: '#174033',
    accent: '#d98a1f',
    paper: '#f7fbf7',
    typeface: 'technical',
    patternStrength: 42,
    document: createWalletDesignDocument({
      primary: '#174033',
      accent: '#d98a1f',
      paper: '#f7fbf7',
      typeface: 'technical',
    }),
    enabled: true,
  },
]
export const DEFAULT_CREDENTIAL_OUTPUT = DEFAULT_CREDENTIAL_OUTPUTS[0]!
export const DEFAULT_WALLET_CREDENTIAL_OUTPUT =
  DEFAULT_CREDENTIAL_OUTPUTS[1] ?? DEFAULT_CREDENTIAL_OUTPUT

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

export function slugCredentialOutputId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (slug || 'credential-output').slice(0, 64)
}

function normalizeCredentialOutput(input: unknown, fallback: CredentialOutput): CredentialOutput {
  const raw = input && typeof input === 'object' ? (input as Partial<CredentialOutput>) : {}
  const design = normalizeCredentialDesign({ ...fallback, ...raw })
  const fallbackDocument =
    fallback.document ??
    (design.format === 'wallet'
      ? createWalletDesignDocument(design)
      : createCertificateDesignDocument(design))
  const name = design.name
  return {
    ...design,
    document: normalizeDesignDocument(raw.document, fallbackDocument),
    id: typeof raw.id === 'string' && raw.id.trim() ? slugCredentialOutputId(raw.id) : fallback.id,
    name,
    description:
      typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim().slice(0, 180)
        : fallback.description,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
  }
}

function outputsFromLegacyDesign(input: unknown): CredentialOutput[] {
  const design = normalizeCredentialDesign(input)
  const fullSizeFormat = design.format === 'wallet' ? 'letter-landscape' : design.format
  return [
    normalizeCredentialOutput(
      {
        ...design,
        id: 'certificate',
        name:
          design.name === DEFAULT_CREDENTIAL_DESIGN.name ? 'Full-size certificate' : design.name,
        format: fullSizeFormat,
        enabled: true,
      },
      DEFAULT_CREDENTIAL_OUTPUT,
    ),
    normalizeCredentialOutput(
      {
        ...design,
        id: 'wallet-card',
        name: 'Wallet card',
        format: 'wallet',
        enabled: true,
      },
      DEFAULT_WALLET_CREDENTIAL_OUTPUT,
    ),
  ]
}

export function normalizeCredentialOutputs(settings: unknown): CredentialOutput[] {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const nextValue = raw[CREDENTIAL_OUTPUTS_SETTINGS_KEY]
  const configured = Array.isArray(nextValue)
    ? nextValue
    : nextValue &&
        typeof nextValue === 'object' &&
        Array.isArray((nextValue as { outputs?: unknown }).outputs)
      ? ((nextValue as { outputs: unknown[] }).outputs ?? [])
      : null

  if (configured?.length) {
    const used = new Set<string>()
    return configured.map((entry, index) => {
      const fallback = DEFAULT_CREDENTIAL_OUTPUTS[index] ?? {
        ...DEFAULT_CREDENTIAL_OUTPUT,
        id: `credential-output-${index + 1}`,
        name: `Credential design ${index + 1}`,
      }
      const normalized = normalizeCredentialOutput(entry, fallback)
      let id = normalized.id
      let suffix = 2
      while (used.has(id)) {
        id = `${normalized.id}-${suffix}`
        suffix += 1
      }
      used.add(id)
      return { ...normalized, id }
    })
  }

  if (raw[CREDENTIAL_DESIGN_SETTINGS_KEY]) {
    return outputsFromLegacyDesign(raw[CREDENTIAL_DESIGN_SETTINGS_KEY])
  }

  return DEFAULT_CREDENTIAL_OUTPUTS
}

export function enabledCredentialOutputs(settings: unknown): CredentialOutput[] {
  const outputs = normalizeCredentialOutputs(settings)
  const enabled = outputs.filter((output) => output.enabled)
  return enabled.length ? enabled : outputs
}

export type CredentialOutputRequest = {
  outputId?: string | null
  format?: 'cert' | 'wallet'
}

export function credentialOutputPdfFormat(output: CredentialOutput): 'cert' | 'wallet' {
  return output.format === 'wallet' ? 'wallet' : 'cert'
}

function pickFromOutputs(
  outputs: CredentialOutput[],
  request: CredentialOutputRequest,
): CredentialOutput {
  if (request.outputId) {
    const output = outputs.find((candidate) => candidate.id === request.outputId)
    if (output) return output
  }

  if (request.format === 'wallet') {
    const output = outputs.find((candidate) => candidate.format === 'wallet')
    if (output) return output
  }

  if (request.format === 'cert') {
    const output = outputs.find((candidate) => candidate.format !== 'wallet')
    if (output) return output
  }

  return outputs[0] ?? DEFAULT_CREDENTIAL_OUTPUT
}

export function resolveCredentialOutput(
  settings: unknown,
  request: CredentialOutputRequest = {},
): CredentialOutput {
  return pickFromOutputs(enabledCredentialOutputs(settings), request)
}

// --- Per-course credential design selection ---------------------------------
// A training course can pin which Card Studio designs it issues (stored on the
// course's `metadata.credentialOutputIds`). When set, only those still-enabled
// designs apply to that course; when empty, the tenant defaults apply.

export const COURSE_CREDENTIAL_OUTPUTS_KEY = 'credentialOutputIds'

export function courseCredentialOutputIds(metadata: unknown): string[] {
  const raw =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)[COURSE_CREDENTIAL_OUTPUTS_KEY]
      : null
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
}

/** Designs available for a course: its pinned selection (still enabled), else tenant defaults. */
export function courseCredentialOutputs(metadata: unknown, settings: unknown): CredentialOutput[] {
  const enabled = enabledCredentialOutputs(settings)
  const ids = courseCredentialOutputIds(metadata)
  if (!ids.length) return enabled
  const picked = enabled.filter((output) => ids.includes(output.id))
  return picked.length ? picked : enabled
}

export function resolveCourseCredentialOutput(
  metadata: unknown,
  settings: unknown,
  request: CredentialOutputRequest = {},
): CredentialOutput {
  return pickFromOutputs(courseCredentialOutputs(metadata, settings), request)
}
