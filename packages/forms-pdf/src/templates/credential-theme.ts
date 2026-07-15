// Shared visual vocabulary for the credential templates (certificate +
// wallet card): colour derivation from the tenant's brand colour, the
// engraved gold-seal SVG, the interlocking-ring security lattice, and
// timezone-safe date formatting for the date-only strings the training
// schema stores.

export function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Tenant branding colours are admin-entered JSON; only let well-formed hex
// through to the stylesheet.
function safeColor(hex: string | null | undefined, fallback: string): string {
  if (hex && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim())) return hex.trim()
  return fallback
}

export type CredentialDesignFormat = 'letter-landscape' | 'letter-portrait' | 'wallet'
export type CredentialDesignTemplateId = 'sovereign-seal' | 'field-pass' | 'clean-authority'
export type CredentialDesignTypeface = 'classic' | 'modern' | 'technical'

export type CredentialDesignOptions = {
  format?: CredentialDesignFormat
  templateId?: CredentialDesignTemplateId
  primary?: string
  accent?: string
  paper?: string
  typeface?: CredentialDesignTypeface
  patternStrength?: number
  showPhoto?: boolean
  showQr?: boolean
  showSeal?: boolean
}

type NormalizedCredentialDesignOptions = Required<CredentialDesignOptions>

const designFormats: CredentialDesignFormat[] = ['letter-landscape', 'letter-portrait', 'wallet']
const designTemplates: CredentialDesignTemplateId[] = [
  'sovereign-seal',
  'field-pass',
  'clean-authority',
]
const designTypefaces: CredentialDesignTypeface[] = ['classic', 'modern', 'technical']

export function normalizeCredentialDesignOptions(
  input: CredentialDesignOptions | null | undefined,
  primaryFallback = '#1f3a5f',
): NormalizedCredentialDesignOptions {
  const raw = input ?? {}
  const primary = safeColor(raw.primary, safeColor(primaryFallback, '#1f3a5f'))
  return {
    format: designFormats.includes(raw.format as CredentialDesignFormat)
      ? (raw.format as CredentialDesignFormat)
      : 'letter-landscape',
    templateId: designTemplates.includes(raw.templateId as CredentialDesignTemplateId)
      ? (raw.templateId as CredentialDesignTemplateId)
      : 'sovereign-seal',
    primary,
    accent: safeColor(raw.accent, '#c2a05c'),
    paper: safeColor(raw.paper, '#fdfcf7'),
    typeface: designTypefaces.includes(raw.typeface as CredentialDesignTypeface)
      ? (raw.typeface as CredentialDesignTypeface)
      : 'classic',
    patternStrength:
      typeof raw.patternStrength === 'number'
        ? Math.max(0, Math.min(80, Math.round(raw.patternStrength)))
        : 56,
    showPhoto: typeof raw.showPhoto === 'boolean' ? raw.showPhoto : true,
    showQr: typeof raw.showQr === 'boolean' ? raw.showQr : true,
    showSeal: typeof raw.showSeal === 'boolean' ? raw.showSeal : true,
  }
}

export function patternOpacity(strength: number, max = 0.08): number {
  return Number(((Math.max(0, Math.min(80, strength)) / 80) * max).toFixed(3))
}

type Rgb = { r: number; g: number; b: number }

function toRgb(hex: string): Rgb {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function mix(hex: string, target: string, ratio: number): string {
  const a = toRgb(hex)
  const b = toRgb(target)
  return toHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  })
}

export const shade = (hex: string, ratio: number): string => mix(hex, '#000000', ratio)
export const tint = (hex: string, ratio: number): string => mix(hex, '#ffffff', ratio)

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = toRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// The schema stores date-only strings (YYYY-MM-DD). `new Date('2026-01-05')`
// parses as UTC midnight, which renders as the previous day in negative-UTC
// timezones — so split the string instead of round-tripping through Date.
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function parseDateOnly(d: string | Date): { y: number; m: number; day: number } | null {
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null
    return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]) - 1, day: Number(m[3]) }
}

export function formatDateLong(d: string | Date): string {
  const p = parseDateOnly(d)
  if (!p) return String(d)
  return `${MONTHS[p.m]} ${p.day}, ${p.y}`
}

export function formatDateShort(d: string | Date): string {
  const p = parseDateOnly(d)
  if (!p) return String(d)
  return `${MONTHS[p.m]!.slice(0, 3)} ${p.day}, ${p.y}`
}

export function initialsOf(fullName: string, max = 2): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, max)
    .join('')
}

// Fixed metallic-gold ramp — pairs well with any tenant brand colour and
// reads unmistakably "credential".
export const GOLD = {
  light: '#e7d3a1',
  mid: '#c2a05c',
  deep: '#9a7b3c',
  shadow: '#7a5f2b',
}

// Interlocking-ring security lattice, tiled as a data-URI background. Subtle
// at the suggested opacities (certificate ~0.05 ink, wallet back ~0.07 white).
export function ringLattice(strokeHex: string, opacity: number): string {
  const c = strokeHex.replaceAll('#', '%23')
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>` +
    `<g fill='none' stroke='${c}' stroke-opacity='${opacity}' stroke-width='0.7'>` +
    `<circle cx='0' cy='60' r='59'/><circle cx='120' cy='60' r='59'/>` +
    `<circle cx='60' cy='0' r='59'/><circle cx='60' cy='120' r='59'/>` +
    `<circle cx='60' cy='60' r='59'/>` +
    `</g></svg>`
  return `url("data:image/svg+xml,${svg}")`
}

// Engraved rosette seal. Scalloped gold medallion with ribbon tails, an arc
// inscription, and the issuer's initials at centre. Pure vector — crisp at
// print resolution on both the certificate and the wallet card.
export function sealSvg(args: {
  initials: string
  ribbon: string
  inscription?: string
  size: number
  showRibbons?: boolean
}): string {
  const { initials, ribbon, size } = args
  const inscription = args.inscription ?? 'CERTIFIED · AUTHENTIC'
  const showRibbons = args.showRibbons !== false
  const scallops: string[] = []
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2
    const x = 80 + Math.cos(a) * 56
    const y = 86 + Math.sin(a) * 56
    scallops.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="9" fill="url(#sealGold)"/>`)
  }
  const ribbons = showRibbons
    ? `<g>
        <polygon points="58,128 40,196 58,180 64,194 72,138" fill="${ribbon}"/>
        <polygon points="102,128 120,196 102,180 96,194 88,138" fill="${ribbon}"/>
        <polygon points="58,128 40,196 58,180 64,194 72,138" fill="#000" opacity="0.18"/>
      </g>`
    : ''
  const ratio = showRibbons ? 200 / 160 : 1
  const height = Math.round(size * ratio)
  const viewH = showRibbons ? 200 : 172
  return `<svg width="${size}" height="${height}" viewBox="0 0 160 ${viewH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sealGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${GOLD.light}"/>
        <stop offset="45%" stop-color="${GOLD.mid}"/>
        <stop offset="75%" stop-color="${GOLD.deep}"/>
        <stop offset="100%" stop-color="${GOLD.mid}"/>
      </linearGradient>
      <radialGradient id="sealCore" cx="38%" cy="32%" r="80%">
        <stop offset="0%" stop-color="${GOLD.mid}"/>
        <stop offset="60%" stop-color="${GOLD.deep}"/>
        <stop offset="100%" stop-color="${GOLD.shadow}"/>
      </radialGradient>
      <path id="sealArc" d="M 44 86 A 36 36 0 0 1 116 86"/>
    </defs>
    ${ribbons}
    ${scallops.join('\n    ')}
    <circle cx="80" cy="86" r="58" fill="url(#sealGold)"/>
    <circle cx="80" cy="86" r="48" fill="none" stroke="${GOLD.light}" stroke-width="1.4"/>
    <circle cx="80" cy="86" r="44" fill="url(#sealCore)"/>
    <text font-family="'Archivo', 'Helvetica Neue', Arial, sans-serif" font-size="6.8" font-weight="600" letter-spacing="1.1" fill="${GOLD.light}">
      <textPath href="#sealArc" startOffset="50%" text-anchor="middle">${esc(inscription)}</textPath>
    </text>
    <text x="80" y="${initials.length > 2 ? 100 : 102}" text-anchor="middle"
      font-family="'Cormorant Garamond', Georgia, serif" font-weight="700"
      font-size="${initials.length > 2 ? 30 : 38}" fill="${GOLD.light}">${esc(initials)}</text>
    <path d="M 62 116 h 36" stroke="${GOLD.light}" stroke-width="1" opacity="0.85"/>
    <path d="M 80 113 l 3.2 3 -3.2 3 -3.2 -3 Z" fill="${GOLD.light}"/>
  </svg>`
}
