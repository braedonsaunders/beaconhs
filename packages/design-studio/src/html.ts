import type {
  CredentialDesignData,
  DataFieldElement,
  DesignArtboard,
  DesignDataField,
  DesignDocument,
  DesignDocumentData,
  DesignElement,
  EquipmentLabelDesignData,
  ImageElement,
  PersonBadgeDesignData,
  TextElement,
} from './schema'

// Internal: every field lookup goes through this widened bag so credential,
// equipment, and person-badge data shapes resolve through one switch without
// unsafe casts at the call sites.
type AnyDesignData = Partial<
  CredentialDesignData & EquipmentLabelDesignData & PersonBadgeDesignData
> & { tenantName: string }

export function renderDesignDocumentHtml(
  document: DesignDocument,
  data: DesignDocumentData,
  options: { artboardId?: string | null; title?: string } = {},
): string {
  const artboards = options.artboardId
    ? document.artboards.filter((artboard) => artboard.id === options.artboardId)
    : document.artboards
  return renderPagesHtml(
    (artboards.length ? artboards : document.artboards).map((artboard) => ({ artboard, data })),
    options.title ?? document.name,
  )
}

/**
 * N documents printed back-to-back as one HTML document — every artboard of
 * every page rendered against that page's own data. All artboards are assumed
 * to share the first artboard's physical size (uniform label runs).
 */
export function renderDesignDocumentsHtml(
  pages: { document: DesignDocument; data: DesignDocumentData }[],
  options: { title?: string } = {},
): string {
  return renderPagesHtml(
    pages.flatMap(({ document, data }) =>
      document.artboards.map((artboard) => ({ artboard, data })),
    ),
    options.title ?? pages[0]?.document.name ?? 'Design document',
  )
}

function renderPagesHtml(
  sections: { artboard: DesignArtboard; data: DesignDocumentData }[],
  title: string,
): string {
  const pages = sections.map(({ artboard, data }) => renderArtboard(artboard, data))
  const first = sections[0]?.artboard
  const pageSize = first ? `${first.width}in ${first.height}in` : '11in 8.5in'
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <style>
    @page { size: ${pageSize}; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Archivo', Arial, sans-serif; }
    .ds-page {
      position: relative;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
      color: #0f172a;
      background: #fff;
    }
    .ds-page:last-child { page-break-after: auto; break-after: auto; }
    .ds-el {
      position: absolute;
      transform-origin: top left;
      overflow: hidden;
      white-space: pre-wrap;
    }
    .ds-fit-contain { object-fit: contain; }
    .ds-fit-cover { object-fit: cover; }
  </style>
</head>
<body>${pages.join('\n')}</body>
</html>`
}

function renderArtboard(artboard: DesignArtboard, data: DesignDocumentData): string {
  const elements = artboard.elements
    .filter((element) => element.visible !== false)
    .map((element) => renderElement(element, data))
    .join('\n')
  return `<section class="ds-page" data-artboard="${esc(artboard.id)}" style="width:${artboard.width}in;height:${artboard.height}in;background:${esc(artboard.background)};">${elements}</section>`
}

function renderElement(element: DesignElement, data: DesignDocumentData): string {
  const style = baseStyle(element)
  switch (element.kind) {
    case 'text':
      return `<div class="ds-el" style="${style}${textStyle(element)}">${esc(element.text)}</div>`
    case 'field':
      return `<div class="ds-el" style="${style}${textStyle(element)}">${esc(resolveField(element, data))}</div>`
    case 'rect':
      return `<div class="ds-el" style="${style}border-radius:${element.radius ?? 0}in;background:${esc(element.fill ?? 'transparent')};border:${element.strokeWidth ?? 0}in solid ${esc(element.stroke ?? 'transparent')};"></div>`
    case 'ellipse':
      return `<div class="ds-el" style="${style}border-radius:50%;background:${esc(element.fill ?? 'transparent')};border:${element.strokeWidth ?? 0}in solid ${esc(element.stroke ?? 'transparent')};"></div>`
    case 'line':
      return `<div class="ds-el" style="${style}border-top:${element.strokeWidth ?? 0.01}in solid ${esc(element.stroke ?? '#0f172a')};height:0;"></div>`
    case 'image':
      return renderImage(element, data, style)
    case 'qr':
      return renderQr(element, data, style)
    case 'seal':
      return renderSeal(element, data, style)
  }
}

function baseStyle(element: DesignElement): string {
  const rotate = element.rotation ? `rotate(${element.rotation}deg)` : 'none'
  // Trailing semicolon matters: callers concatenate more declarations directly
  // after this string — without it the next property merges into `transform`
  // and both are silently dropped (square seals, lost rotations/radii).
  return (
    [
      `left:${element.x}in`,
      `top:${element.y}in`,
      `width:${element.width}in`,
      `height:${element.height}in`,
      `opacity:${element.opacity ?? 1}`,
      `transform:${rotate}`,
    ].join(';') + ';'
  )
}

function textStyle(element: TextElement | DataFieldElement): string {
  return [
    `font-family:${element.fontFamily ?? "'Archivo', Arial, sans-serif"}`,
    `font-size:${element.fontSize ?? 12}pt`,
    `font-weight:${element.fontWeight ?? '600'}`,
    `font-style:${element.fontStyle ?? 'normal'}`,
    `color:${element.color ?? '#0f172a'}`,
    `text-align:${element.align ?? 'left'}`,
    `letter-spacing:${element.letterSpacing ?? 0}in`,
    `line-height:${element.lineHeight ?? 1.15}`,
    // Legacy templates rely on word-break for narrow columns (asset tags,
    // tokens) — without this, unbroken strings clip at the box edge.
    'overflow-wrap:anywhere',
    'display:flex',
    element.align === 'center'
      ? 'justify-content:center'
      : element.align === 'right'
        ? 'justify-content:flex-end'
        : 'justify-content:flex-start',
    'align-items:center',
  ].join(';')
}

function renderImage(element: ImageElement, data: DesignDocumentData, style: string): string {
  const bag = data as AnyDesignData
  const src =
    element.source === 'tenant.logo'
      ? bag.tenantLogoUrl
      : element.source === 'recipient.photo'
        ? bag.recipientPhotoUrl
        : element.url
  const radius = element.radius ?? 0
  if (!src) {
    return `<div class="ds-el" style="${style}border:${0.01}in dashed #cbd5e1;border-radius:${radius}in;background:#f8fafc;color:#94a3b8;font-size:6pt;display:flex;align-items:center;justify-content:center;">${esc(element.name)}</div>`
  }
  return `<img class="ds-el ds-fit-${element.fit ?? 'contain'}" src="${esc(src)}" alt="" style="${style}border-radius:${radius}in;display:block;"/>`
}

function renderQr(
  element: Extract<DesignElement, { kind: 'qr' }>,
  data: DesignDocumentData,
  style: string,
): string {
  if (data.qrDataUrl) {
    return `<img class="ds-el" src="${esc(data.qrDataUrl)}" alt="" style="${style}background:${esc(element.background ?? '#fff')};padding:0.03in;"/>`
  }
  return `<div class="ds-el" style="${style}background:${esc(element.background ?? '#fff')};border:0.01in solid #cbd5e1;color:${esc(element.foreground ?? '#0f172a')};font-size:8pt;display:flex;align-items:center;justify-content:center;">QR</div>`
}

function renderSeal(
  element: Extract<DesignElement, { kind: 'seal' }>,
  data: DesignDocumentData,
  style: string,
): string {
  const initials = (data.tenantName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase())
    .slice(0, 2)
    .join('')
  const label = element.text || initials || 'OK'
  return `<div class="ds-el" style="${style}border-radius:50%;background:${esc(element.fill ?? '#c2a05c')};border:0.025in solid ${esc(element.stroke ?? '#7a5f2b')};color:#fff;font-weight:800;font-size:14pt;display:flex;align-items:center;justify-content:center;text-align:center;">${esc(label)}</div>`
}

function resolveField(element: DataFieldElement, data: DesignDocumentData): string {
  const raw = valueForField(element.field, data)
  let value = raw || element.fallback || ''
  // No value and no explicit fallback → render nothing, including the
  // prefix/suffix — a dangling "Last: " with no date reads as broken output.
  if (!value) return ''
  if (element.transform === 'uppercase') value = value.toUpperCase()
  if (element.transform === 'date-long') value = formatDate(value, 'long')
  if (element.transform === 'date-short') value = formatDate(value, 'short')
  return `${element.prefix ?? ''}${value}${element.suffix ?? ''}`
}

export function valueForField(field: DesignDataField, data: DesignDocumentData): string {
  const bag = data as AnyDesignData
  switch (field) {
    case 'tenant.name':
      return bag.tenantName
    case 'tenant.logo':
      return bag.tenantLogoUrl ?? ''
    case 'recipient.fullName':
      return bag.recipientFullName ?? ''
    case 'recipient.employeeNo':
      return bag.recipientEmployeeNo ?? ''
    case 'recipient.photo':
      return bag.recipientPhotoUrl ?? ''
    case 'credential.name':
      return bag.credentialName ?? ''
    case 'credential.code':
      return bag.credentialCode ?? ''
    case 'authority.name':
      return bag.authorityName ?? ''
    case 'completedOn':
      return bag.completedOn ?? ''
    case 'expiresOn':
      return bag.expiresOn ?? ''
    case 'instructor':
      return bag.instructor ?? ''
    case 'grade':
      return bag.grade == null ? '' : `${bag.grade}%`
    case 'verify.url':
      return bag.verifyUrl ?? ''
    case 'verify.token':
      return bag.verifyToken ?? ''
    case 'verify.qr':
      return bag.qrDataUrl ?? ''
    case 'issuedAt':
      return bag.issuedAt ? String(bag.issuedAt) : ''
    case 'person.title':
      return bag.personTitle ?? ''
    case 'person.department':
      return bag.personDepartment ?? ''
    case 'equipment.name':
      return bag.equipmentName ?? ''
    case 'equipment.assetTag':
      return bag.equipmentAssetTag ?? ''
    case 'equipment.serial':
      return bag.equipmentSerial ?? ''
    case 'equipment.class':
      return bag.equipmentClass ?? ''
    case 'equipment.division':
      return bag.equipmentDivision ?? ''
    case 'equipment.lastInspection':
      return bag.lastInspection ?? ''
    case 'equipment.nextInspectionDue':
      return bag.nextInspectionDue ?? ''
  }
}

function formatDate(value: string, format: 'long' | 'short'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const year = match[1] ?? ''
  const monthPart = match[2] ?? ''
  const day = Number(match[3] ?? 1)
  const month = MONTHS[Number(monthPart) - 1] ?? monthPart
  return format === 'short' ? `${month.slice(0, 3)} ${day}, ${year}` : `${month} ${day}, ${year}`
}

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

function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
