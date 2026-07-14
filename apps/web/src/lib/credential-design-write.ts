import {
  DESIGN_DOCUMENT_LIMITS,
  type CredentialDataField,
  type DesignElement,
} from '@beaconhs/design-studio'
import type { CredentialOutput } from './credential-designs'

export const CREDENTIAL_OUTPUT_LIMITS = {
  maxOutputs: 24,
  maxJsonBytes: 900_000,
  idLength: 64,
  nameLength: 120,
  descriptionLength: 180,
} as const

const OUTPUT_FORMATS = ['letter-landscape', 'letter-portrait', 'wallet'] as const
const TEMPLATE_IDS = ['sovereign-seal', 'field-pass', 'clean-authority'] as const
const TYPEFACES = ['classic', 'modern', 'technical'] as const
const ARTBOARD_FORMATS = [
  'letter-landscape',
  'letter-portrait',
  'cr80-front',
  'cr80-back',
  'label-4x6',
  'custom',
] as const
const DOCUMENT_FIELDS: readonly CredentialDataField[] = [
  'tenant.name',
  'tenant.logo',
  'recipient.fullName',
  'recipient.employeeNo',
  'recipient.photo',
  'credential.name',
  'credential.code',
  'authority.name',
  'completedOn',
  'expiresOn',
  'instructor',
  'grade',
  'verify.url',
  'verify.token',
  'verify.qr',
  'issuedAt',
]
const ELEMENT_KINDS: readonly DesignElement['kind'][] = [
  'text',
  'field',
  'rect',
  'ellipse',
  'line',
  'image',
  'qr',
  'seal',
]
const STABLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const FONT_FAMILY = /^[A-Za-z0-9 '"(),._-]+$/

const OUTPUT_KEYS = [
  'id',
  'name',
  'description',
  'enabled',
  'format',
  'templateId',
  'primary',
  'accent',
  'paper',
  'typeface',
  'patternStrength',
  'showPhoto',
  'showQr',
  'showSeal',
  'document',
] as const
const DOCUMENT_KEYS = ['version', 'engine', 'kind', 'name', 'unit', 'dpi', 'artboards'] as const
const ARTBOARD_KEYS = [
  'id',
  'name',
  'format',
  'width',
  'height',
  'background',
  'bleed',
  'printProfile',
  'elements',
] as const
const BASE_ELEMENT_KEYS = [
  'id',
  'name',
  'kind',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
] as const
const TEXT_STYLE_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'color',
  'align',
  'letterSpacing',
  'lineHeight',
] as const
const FILL_STROKE_KEYS = ['fill', 'stroke', 'strokeWidth', 'radius'] as const

export class CredentialDesignValidationError extends Error {
  override name = 'CredentialDesignValidationError'
}

function fail(message: string): never {
  throw new CredentialDesignValidationError(message)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object.`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed)
  const extra = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (extra) fail(`${path} contains an unsupported “${extra}” field.`)
}

function requiredString(
  value: unknown,
  path: string,
  maxLength: number,
  options: { allowEmpty?: boolean; requireTrimmed?: boolean } = {},
): string {
  if (typeof value !== 'string') fail(`${path} must be text.`)
  if (value.length > maxLength) fail(`${path} must be ${maxLength} characters or less.`)
  if (UNSAFE_CONTROL.test(value)) fail(`${path} contains invalid control characters.`)
  if (options.requireTrimmed && value !== value.trim()) {
    fail(`${path} cannot start or end with spaces.`)
  }
  if (!options.allowEmpty && !value.trim()) fail(`${path} is required.`)
  return value
}

function optionalString(
  value: unknown,
  path: string,
  maxLength: number,
  options: { requireTrimmed?: boolean } = {},
): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, path, maxLength, {
    allowEmpty: true,
    requireTrimmed: options.requireTrimmed,
  })
}

function enumValue(value: unknown, allowed: readonly string[], path: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(`${path} has an unsupported value.`)
  }
  return value
}

function booleanValue(value: unknown, path: string): void {
  if (typeof value !== 'boolean') fail(`${path} must be true or false.`)
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined) booleanValue(value, path)
}

function numberValue(
  value: unknown,
  path: string,
  min: number,
  max: number,
  options: { integer?: boolean } = {},
): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (options.integer && !Number.isInteger(value))
  ) {
    fail(
      `${path} must be ${options.integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`,
    )
  }
}

function optionalNumber(value: unknown, path: string, min: number, max: number): void {
  if (value !== undefined) numberValue(value, path, min, max)
}

function stableId(value: unknown, path: string, maxLength: number): string {
  const id = requiredString(value, path, maxLength, { requireTrimmed: true })
  if (!STABLE_ID.test(id)) {
    fail(`${path} must use lowercase letters, numbers, and single hyphens.`)
  }
  return id
}

function hexColor(value: unknown, path: string): void {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    fail(`${path} must be a six-digit hex colour such as #0f766e.`)
  }
}

function paint(value: unknown, path: string): void {
  if (value !== 'transparent') hexColor(value, path)
}

function optionalPaint(value: unknown, path: string): void {
  if (value !== undefined) paint(value, path)
}

function jsonBytes(value: unknown, path: string, maxBytes: number): void {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch {
    fail(`${path} must be valid JSON data.`)
  }
  if (encoded === undefined) fail(`${path} must be valid JSON data.`)
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    fail(`${path} is too large. Keep it under ${Math.floor(maxBytes / 1_000)} KB.`)
  }
}

function validatePrintProfile(value: unknown, path: string): void {
  if (value === undefined) return
  const profile = record(value, path)
  exactKeys(profile, ['provider', 'media', 'duplex', 'edgeToEdge', 'orientation'], path)
  enumValue(
    profile.provider,
    ['browser-pdf', 'zebra-browser-print', 'evolis-sdk', 'hid-fargo-sdk'],
    `${path} provider`,
  )
  enumValue(profile.media, ['letter', 'cr80', 'custom'], `${path} media`)
  optionalBoolean(profile.duplex, `${path} duplex setting`)
  optionalBoolean(profile.edgeToEdge, `${path} edge-to-edge setting`)
  if (profile.orientation !== undefined) {
    enumValue(profile.orientation, ['portrait', 'landscape'], `${path} orientation`)
  }
}

function validateTextStyle(element: Record<string, unknown>, path: string): void {
  if (element.fontFamily !== undefined) {
    const family = requiredString(
      element.fontFamily,
      `${path} font family`,
      DESIGN_DOCUMENT_LIMITS.fontFamilyLength,
      { requireTrimmed: true },
    )
    if (!FONT_FAMILY.test(family)) fail(`${path} font family contains unsupported characters.`)
  }
  optionalNumber(element.fontSize, `${path} font size`, 3, 120)
  if (element.fontWeight !== undefined) {
    enumValue(element.fontWeight, ['400', '500', '600', '700', '800'], `${path} font weight`)
  }
  if (element.fontStyle !== undefined) {
    enumValue(element.fontStyle, ['normal', 'italic'], `${path} font style`)
  }
  if (element.color !== undefined) hexColor(element.color, `${path} text colour`)
  if (element.align !== undefined) {
    enumValue(element.align, ['left', 'center', 'right'], `${path} alignment`)
  }
  optionalNumber(element.letterSpacing, `${path} letter spacing`, 0, 0.25)
  optionalNumber(element.lineHeight, `${path} line height`, 0.8, 2)
}

function validateFillStroke(element: Record<string, unknown>, path: string): void {
  optionalPaint(element.fill, `${path} fill`)
  optionalPaint(element.stroke, `${path} stroke`)
  optionalNumber(element.strokeWidth, `${path} stroke width`, 0, 0.2)
  optionalNumber(element.radius, `${path} corner radius`, 0, 1)
}

function validateImageUrl(value: unknown, path: string): void {
  const raw = optionalString(value, path, DESIGN_DOCUMENT_LIMITS.imageUrlLength, {
    requireTrimmed: true,
  })
  if (!raw) return
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    fail(`${path} must be a complete HTTPS URL.`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    fail(`${path} must be a credential-free HTTPS URL.`)
  }
}

function validateElement(value: unknown, path: string): string {
  const element = record(value, path)
  const kind = enumValue(element.kind, ELEMENT_KINDS, `${path} type`) as DesignElement['kind']
  const kindKeys =
    kind === 'text'
      ? ['text', ...TEXT_STYLE_KEYS]
      : kind === 'field'
        ? ['field', 'fallback', 'prefix', 'suffix', 'transform', ...TEXT_STYLE_KEYS]
        : kind === 'image'
          ? ['source', 'url', 'fit', 'radius']
          : kind === 'qr'
            ? ['field', 'background', 'foreground']
            : kind === 'seal'
              ? ['text', 'fill', 'stroke']
              : FILL_STROKE_KEYS
  exactKeys(element, [...BASE_ELEMENT_KEYS, ...kindKeys], path)

  const id = stableId(element.id, `${path} ID`, DESIGN_DOCUMENT_LIMITS.idLength)
  requiredString(element.name, `${path} name`, DESIGN_DOCUMENT_LIMITS.elementNameLength, {
    requireTrimmed: true,
  })
  numberValue(element.x, `${path} X position`, -40, 40)
  numberValue(element.y, `${path} Y position`, -40, 40)
  numberValue(element.width, `${path} width`, 0.05, 40)
  numberValue(element.height, `${path} height`, 0.001, 40)
  optionalNumber(element.rotation, `${path} rotation`, -360, 360)
  optionalNumber(element.opacity, `${path} opacity`, 0, 1)
  optionalBoolean(element.visible, `${path} visibility`)
  optionalBoolean(element.locked, `${path} lock setting`)

  if (kind === 'text') {
    requiredString(element.text, `${path} text`, DESIGN_DOCUMENT_LIMITS.textLength, {
      allowEmpty: true,
    })
    validateTextStyle(element, path)
  } else if (kind === 'field') {
    enumValue(element.field, DOCUMENT_FIELDS, `${path} data field`)
    optionalString(
      element.fallback,
      `${path} empty-value fallback`,
      DESIGN_DOCUMENT_LIMITS.fieldFallbackLength,
    )
    optionalString(element.prefix, `${path} prefix`, DESIGN_DOCUMENT_LIMITS.fieldAffixLength)
    optionalString(element.suffix, `${path} suffix`, DESIGN_DOCUMENT_LIMITS.fieldAffixLength)
    if (element.transform !== undefined) {
      enumValue(
        element.transform,
        ['none', 'uppercase', 'date-long', 'date-short'],
        `${path} format`,
      )
    }
    validateTextStyle(element, path)
  } else if (kind === 'rect' || kind === 'ellipse' || kind === 'line') {
    validateFillStroke(element, path)
  } else if (kind === 'image') {
    const source = enumValue(
      element.source,
      ['tenant.logo', 'recipient.photo', 'upload', 'url'],
      `${path} image source`,
    )
    validateImageUrl(element.url, `${path} image URL`)
    if ((source === 'upload' || source === 'url') && !element.url) {
      fail(`${path} needs an image URL for the selected source.`)
    }
    if (element.fit !== undefined) enumValue(element.fit, ['cover', 'contain'], `${path} image fit`)
    optionalNumber(element.radius, `${path} corner radius`, 0, 1)
  } else if (kind === 'qr') {
    if (element.field !== 'verify.qr') fail(`${path} must use the verification QR field.`)
    optionalPaint(element.background, `${path} background`)
    optionalPaint(element.foreground, `${path} foreground`)
  } else {
    optionalString(element.text, `${path} text`, DESIGN_DOCUMENT_LIMITS.sealTextLength)
    optionalPaint(element.fill, `${path} fill`)
    optionalPaint(element.stroke, `${path} stroke`)
  }
  return id
}

function validateArtboard(value: unknown, path: string): string {
  const artboard = record(value, path)
  exactKeys(artboard, ARTBOARD_KEYS, path)
  const id = stableId(artboard.id, `${path} ID`, DESIGN_DOCUMENT_LIMITS.idLength)
  requiredString(artboard.name, `${path} name`, DESIGN_DOCUMENT_LIMITS.artboardNameLength, {
    requireTrimmed: true,
  })
  enumValue(artboard.format, ARTBOARD_FORMATS, `${path} format`)
  numberValue(artboard.width, `${path} width`, 1, 40)
  numberValue(artboard.height, `${path} height`, 1, 40)
  paint(artboard.background, `${path} background`)
  optionalNumber(artboard.bleed, `${path} bleed`, 0, 0.25)
  validatePrintProfile(artboard.printProfile, `${path} print profile`)
  if (!Array.isArray(artboard.elements)) fail(`${path} elements must be a list.`)
  if (artboard.elements.length > DESIGN_DOCUMENT_LIMITS.maxElementsPerArtboard) {
    fail(
      `${path} can contain no more than ${DESIGN_DOCUMENT_LIMITS.maxElementsPerArtboard} elements.`,
    )
  }
  const elementIds = new Set<string>()
  artboard.elements.forEach((element, index) => {
    const elementPath = `${path}, element ${index + 1}`
    const elementId = validateElement(element, elementPath)
    if (elementIds.has(elementId)) fail(`${path} contains duplicate element ID “${elementId}”.`)
    elementIds.add(elementId)
  })
  return id
}

function validateDocument(value: unknown, path: string): void {
  jsonBytes(value, path, DESIGN_DOCUMENT_LIMITS.maxJsonBytes)
  const document = record(value, path)
  exactKeys(document, DOCUMENT_KEYS, path)
  if (document.version !== 1) fail(`${path} version is unsupported.`)
  if (document.engine !== 'fabric') fail(`${path} engine is unsupported.`)
  if (document.kind !== 'training-credential') fail(`${path} must be a training credential.`)
  requiredString(document.name, `${path} name`, DESIGN_DOCUMENT_LIMITS.documentNameLength, {
    requireTrimmed: true,
  })
  if (document.unit !== 'in') fail(`${path} must use inches.`)
  numberValue(document.dpi, `${path} DPI`, 72, 300, { integer: true })
  if (!Array.isArray(document.artboards)) fail(`${path} artboards must be a list.`)
  if (document.artboards.length < 1) fail(`${path} needs at least one artboard.`)
  if (document.artboards.length > DESIGN_DOCUMENT_LIMITS.maxArtboards) {
    fail(`${path} can contain no more than ${DESIGN_DOCUMENT_LIMITS.maxArtboards} artboards.`)
  }
  const artboardIds = new Set<string>()
  document.artboards.forEach((artboard, index) => {
    const artboardPath = `${path}, artboard ${index + 1}`
    const artboardId = validateArtboard(artboard, artboardPath)
    if (artboardIds.has(artboardId)) {
      fail(`${path} contains duplicate artboard ID “${artboardId}”.`)
    }
    artboardIds.add(artboardId)
  })
}

function validateOutput(value: unknown, index: number): string {
  const path = `Design ${index + 1}`
  const output = record(value, path)
  exactKeys(output, OUTPUT_KEYS, path)
  const id = stableId(output.id, `${path} ID`, CREDENTIAL_OUTPUT_LIMITS.idLength)
  requiredString(output.name, `${path} name`, CREDENTIAL_OUTPUT_LIMITS.nameLength, {
    requireTrimmed: true,
  })
  requiredString(
    output.description,
    `${path} description`,
    CREDENTIAL_OUTPUT_LIMITS.descriptionLength,
    { allowEmpty: true, requireTrimmed: true },
  )
  booleanValue(output.enabled, `${path} availability`)
  enumValue(output.format, OUTPUT_FORMATS, `${path} output format`)
  enumValue(output.templateId, TEMPLATE_IDS, `${path} template`)
  hexColor(output.primary, `${path} primary colour`)
  hexColor(output.accent, `${path} accent colour`)
  hexColor(output.paper, `${path} paper colour`)
  enumValue(output.typeface, TYPEFACES, `${path} typeface`)
  numberValue(output.patternStrength, `${path} pattern strength`, 0, 80, { integer: true })
  booleanValue(output.showPhoto, `${path} photo setting`)
  booleanValue(output.showQr, `${path} QR setting`)
  booleanValue(output.showSeal, `${path} seal setting`)
  validateDocument(output.document, `${path} document`)
  return id
}

/** Strict server-write boundary. Validation never trims, clamps, drops, or rewrites accepted data. */
export function parseCredentialOutputsForSave(value: unknown): CredentialOutput[] {
  jsonBytes(value, 'Credential designs', CREDENTIAL_OUTPUT_LIMITS.maxJsonBytes)
  if (!Array.isArray(value)) fail('Credential designs must be a list.')
  if (value.length < 1) fail('Keep at least one credential design.')
  if (value.length > CREDENTIAL_OUTPUT_LIMITS.maxOutputs) {
    fail(`You can save no more than ${CREDENTIAL_OUTPUT_LIMITS.maxOutputs} credential designs.`)
  }
  const outputIds = new Set<string>()
  value.forEach((output, index) => {
    const outputId = validateOutput(output, index)
    if (outputIds.has(outputId)) fail(`Credential design ID “${outputId}” is duplicated.`)
    outputIds.add(outputId)
  })
  return value as CredentialOutput[]
}

export function parseCredentialOutputForPreview(value: unknown): CredentialOutput {
  return parseCredentialOutputsForSave([value])[0]!
}
