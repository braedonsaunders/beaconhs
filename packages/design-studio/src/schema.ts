export type DesignUnit = 'in'

export type ArtboardFormat =
  | 'letter-landscape'
  | 'letter-portrait'
  | 'cr80-front'
  | 'cr80-back'
  | 'label-4x6'
  | 'custom'

export type DesignDocumentKind =
  | 'training-credential'
  | 'training-slides'
  | 'equipment-label'
  | 'generic'

export type DesignDocument = {
  version: 1
  engine: 'fabric'
  kind: DesignDocumentKind
  name: string
  unit: DesignUnit
  dpi: number
  artboards: DesignArtboard[]
}

export type DesignArtboard = {
  id: string
  name: string
  format: ArtboardFormat
  width: number
  height: number
  background: string
  bleed?: number
  printProfile?: PrintProfile
  elements: DesignElement[]
}

export type PrintProvider = 'browser-pdf' | 'zebra-browser-print' | 'evolis-sdk' | 'hid-fargo-sdk'

export type PrintProfile = {
  provider: PrintProvider
  media: 'letter' | 'cr80' | 'custom'
  duplex?: boolean
  edgeToEdge?: boolean
  orientation?: 'portrait' | 'landscape'
}

export type CredentialDataField =
  | 'tenant.name'
  | 'tenant.logo'
  | 'recipient.fullName'
  | 'recipient.employeeNo'
  | 'recipient.photo'
  | 'credential.name'
  | 'credential.code'
  | 'authority.name'
  | 'completedOn'
  | 'expiresOn'
  | 'instructor'
  | 'grade'
  | 'verify.url'
  | 'verify.token'
  | 'verify.qr'
  | 'issuedAt'

// Equipment QR-label catalog. `tenant.name`, `verify.url`, and `verify.qr`
// deliberately reuse the credential keys so shared elements (QR, issuer)
// resolve identically from either data shape.
export type EquipmentDataField =
  | 'tenant.name'
  | 'equipment.name'
  | 'equipment.assetTag'
  | 'equipment.serial'
  | 'equipment.class'
  | 'equipment.division'
  | 'equipment.lastInspection'
  | 'equipment.nextInspectionDue'
  | 'verify.qr'
  | 'verify.url'

export type DesignDataField = CredentialDataField | EquipmentDataField

export type BaseElement = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  opacity?: number
  visible?: boolean
  locked?: boolean
}

export type TextStyle = {
  fontFamily?: string
  fontSize?: number
  fontWeight?: '400' | '500' | '600' | '700' | '800'
  fontStyle?: 'normal' | 'italic'
  color?: string
  align?: 'left' | 'center' | 'right'
  letterSpacing?: number
  lineHeight?: number
}

export type FillStroke = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  radius?: number
}

export type TextElement = BaseElement &
  TextStyle & {
    kind: 'text'
    text: string
  }

export type DataFieldElement = BaseElement &
  TextStyle & {
    kind: 'field'
    field: DesignDataField
    fallback?: string
    prefix?: string
    suffix?: string
    transform?: 'none' | 'uppercase' | 'date-long' | 'date-short'
  }

export type ShapeElement = BaseElement &
  FillStroke & {
    kind: 'rect' | 'ellipse'
  }

export type LineElement = BaseElement &
  FillStroke & {
    kind: 'line'
  }

export type ImageElement = BaseElement & {
  kind: 'image'
  source: 'tenant.logo' | 'recipient.photo' | 'upload' | 'url'
  url?: string
  fit?: 'cover' | 'contain'
  radius?: number
}

export type QrElement = BaseElement & {
  kind: 'qr'
  field: 'verify.qr'
  background?: string
  foreground?: string
}

export type SealElement = BaseElement & {
  kind: 'seal'
  text?: string
  fill?: string
  stroke?: string
}

export type DesignElement =
  | TextElement
  | DataFieldElement
  | ShapeElement
  | LineElement
  | ImageElement
  | QrElement
  | SealElement

export type CredentialDesignData = {
  tenantName: string
  tenantLogoUrl?: string | null
  recipientFullName: string
  recipientEmployeeNo?: string | null
  recipientPhotoUrl?: string | null
  credentialName: string
  credentialCode?: string | null
  authorityName?: string | null
  completedOn?: string | null
  expiresOn?: string | null
  instructor?: string | null
  grade?: number | null
  verifyUrl?: string | null
  verifyToken?: string | null
  qrDataUrl?: string | null
  issuedAt?: string | Date | null
}

export type EquipmentLabelDesignData = {
  tenantName: string
  tenantLogoUrl?: string | null
  equipmentName: string
  equipmentAssetTag?: string | null
  equipmentSerial?: string | null
  /** "Category • Type" — pre-joined by the caller. */
  equipmentClass?: string | null
  /** Site / org-unit name shown in the header band. */
  equipmentDivision?: string | null
  /** ISO dates (YYYY-MM-DD) so field date transforms apply. */
  lastInspection?: string | null
  nextInspectionDue?: string | null
  verifyUrl?: string | null
  qrDataUrl?: string | null
}

/** Any data shape a design document can be rendered against. */
export type DesignDocumentData = CredentialDesignData | EquipmentLabelDesignData

export function isDesignDocument(value: unknown): value is DesignDocument {
  const doc = value as Partial<DesignDocument> | null
  return (
    !!doc &&
    doc.version === 1 &&
    doc.engine === 'fabric' &&
    doc.unit === 'in' &&
    typeof doc.name === 'string' &&
    typeof doc.dpi === 'number' &&
    Array.isArray(doc.artboards)
  )
}

export function artboardSizeForFormat(format: ArtboardFormat): { width: number; height: number } {
  switch (format) {
    case 'letter-portrait':
      return { width: 8.5, height: 11 }
    case 'cr80-front':
    case 'cr80-back':
      return { width: 3.375, height: 2.125 }
    case 'label-4x6':
      return { width: 4, height: 6 }
    case 'letter-landscape':
      return { width: 11, height: 8.5 }
    case 'custom':
      return { width: 11, height: 8.5 }
  }
}

export function normalizeDesignDocument(input: unknown, fallback: DesignDocument): DesignDocument {
  if (!isDesignDocument(input)) return fallback
  const artboards = input.artboards
    .filter((artboard) => artboard && typeof artboard.id === 'string')
    .slice(0, 12)
    .map((artboard, index) => normalizeArtboard(artboard, fallback.artboards[index]))
  return {
    version: 1,
    engine: 'fabric',
    kind: input.kind ?? fallback.kind,
    name: input.name.trim().slice(0, 120) || fallback.name,
    unit: 'in',
    dpi: clampNumber(input.dpi, 72, 300, fallback.dpi),
    artboards: artboards.length ? artboards : fallback.artboards,
  }
}

function normalizeArtboard(
  input: DesignArtboard,
  fallback: DesignArtboard | undefined,
): DesignArtboard {
  const fallbackSize = fallback
    ? { width: fallback.width, height: fallback.height }
    : artboardSizeForFormat(input.format)
  const format: ArtboardFormat = [
    'letter-landscape',
    'letter-portrait',
    'cr80-front',
    'cr80-back',
    'label-4x6',
    'custom',
  ].includes(input.format)
    ? input.format
    : (fallback?.format ?? 'letter-landscape')
  const size = format === 'custom' ? fallbackSize : artboardSizeForFormat(format)
  return {
    id: slugId(input.id, fallback?.id ?? 'artboard'),
    name: input.name?.trim().slice(0, 80) || fallback?.name || 'Artboard',
    format,
    width: clampNumber(input.width, 1, 40, size.width),
    height: clampNumber(input.height, 1, 40, size.height),
    background: safeColor(input.background, fallback?.background ?? '#ffffff'),
    bleed: clampNumber(input.bleed, 0, 0.25, fallback?.bleed ?? 0),
    printProfile: normalizePrintProfile(input.printProfile, fallback?.printProfile),
    elements: Array.isArray(input.elements)
      ? input.elements.slice(0, 240).map((element, index) => normalizeElement(element, index))
      : (fallback?.elements ?? []),
  }
}

function normalizePrintProfile(
  input: PrintProfile | undefined,
  fallback: PrintProfile | undefined,
): PrintProfile | undefined {
  if (!input) return fallback
  const provider = ['browser-pdf', 'zebra-browser-print', 'evolis-sdk', 'hid-fargo-sdk'].includes(
    input.provider,
  )
    ? input.provider
    : (fallback?.provider ?? 'browser-pdf')
  const media = ['letter', 'cr80', 'custom'].includes(input.media)
    ? input.media
    : (fallback?.media ?? 'letter')
  return {
    provider,
    media,
    duplex: typeof input.duplex === 'boolean' ? input.duplex : (fallback?.duplex ?? false),
    edgeToEdge:
      typeof input.edgeToEdge === 'boolean' ? input.edgeToEdge : (fallback?.edgeToEdge ?? true),
    orientation: ['portrait', 'landscape'].includes(input.orientation ?? '')
      ? input.orientation
      : fallback?.orientation,
  }
}

function normalizeElement(input: DesignElement, index: number): DesignElement {
  const base = {
    id: slugId(input.id, `element-${index + 1}`),
    name: input.name?.trim().slice(0, 80) || `Element ${index + 1}`,
    x: clampNumber(input.x, -40, 40, 0.25),
    y: clampNumber(input.y, -40, 40, 0.25),
    width: clampNumber(input.width, 0.05, 40, 1),
    height: clampNumber(input.height, 0.05, 40, 0.4),
    rotation: clampNumber(input.rotation, -360, 360, 0),
    opacity: clampNumber(input.opacity, 0, 1, 1),
    visible: input.visible !== false,
    locked: input.locked === true,
  }
  switch (input.kind) {
    case 'text':
      return { ...base, kind: 'text', text: input.text ?? '', ...normalizeText(input) }
    case 'field':
      return {
        ...base,
        kind: 'field',
        field: input.field,
        fallback: input.fallback?.slice(0, 200),
        prefix: input.prefix?.slice(0, 40),
        suffix: input.suffix?.slice(0, 40),
        transform: ['none', 'uppercase', 'date-long', 'date-short'].includes(input.transform ?? '')
          ? input.transform
          : 'none',
        ...normalizeText(input),
      }
    case 'ellipse':
      return { ...base, kind: 'ellipse', ...normalizeFillStroke(input) }
    case 'line':
      return { ...base, kind: 'line', ...normalizeFillStroke(input) }
    case 'image':
      return {
        ...base,
        kind: 'image',
        source: ['tenant.logo', 'recipient.photo', 'upload', 'url'].includes(input.source)
          ? input.source
          : 'url',
        url: input.url?.slice(0, 2000),
        fit: input.fit === 'cover' ? 'cover' : 'contain',
        radius: clampNumber(input.radius, 0, 1, 0),
      }
    case 'qr':
      return {
        ...base,
        kind: 'qr',
        field: 'verify.qr',
        background: safeColor(input.background, '#ffffff'),
        foreground: safeColor(input.foreground, '#0f172a'),
      }
    case 'seal':
      return {
        ...base,
        kind: 'seal',
        text: input.text?.slice(0, 80),
        fill: safeColor(input.fill, '#c2a05c'),
        stroke: safeColor(input.stroke, '#7a5f2b'),
      }
    case 'rect':
    default:
      return { ...base, kind: 'rect', ...normalizeFillStroke(input as ShapeElement) }
  }
}

function normalizeText(input: Partial<TextStyle>): TextStyle {
  return {
    fontFamily: input.fontFamily?.slice(0, 120) || "'Archivo', Arial, sans-serif",
    fontSize: clampNumber(input.fontSize, 3, 120, 14),
    fontWeight: ['400', '500', '600', '700', '800'].includes(input.fontWeight ?? '')
      ? input.fontWeight
      : '600',
    fontStyle: input.fontStyle === 'italic' ? 'italic' : 'normal',
    color: safeColor(input.color, '#0f172a'),
    align: ['left', 'center', 'right'].includes(input.align ?? '') ? input.align : 'left',
    letterSpacing: clampNumber(input.letterSpacing, 0, 0.25, 0),
    lineHeight: clampNumber(input.lineHeight, 0.8, 2, 1.15),
  }
}

function normalizeFillStroke(input: Partial<FillStroke>): FillStroke {
  return {
    fill: safeColor(input.fill, '#ffffff'),
    stroke: safeColor(input.stroke, '#cbd5e1'),
    strokeWidth: clampNumber(input.strokeWidth, 0, 0.2, 0.01),
    radius: clampNumber(input.radius, 0, 1, 0),
  }
}

export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

export function slugId(value: string | null | undefined, fallback: string): string {
  const id = (value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (id || fallback).slice(0, 80)
}

export function clampNumber(
  value: number | null | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}
