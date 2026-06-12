import type {
  CredentialDataField,
  CredentialDesignData,
  DataFieldElement,
  DesignArtboard,
  DesignDocument,
  DesignElement,
  ImageElement,
  TextElement,
} from './schema'

export function renderDesignDocumentHtml(
  document: DesignDocument,
  data: CredentialDesignData,
  options: { artboardId?: string | null; title?: string } = {},
): string {
  const artboards = options.artboardId
    ? document.artboards.filter((artboard) => artboard.id === options.artboardId)
    : document.artboards
  const pages = (artboards.length ? artboards : document.artboards).map((artboard) =>
    renderArtboard(artboard, data),
  )
  const first = artboards[0] ?? document.artboards[0]
  const pageSize = first ? `${first.width}in ${first.height}in` : '11in 8.5in'
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${esc(options.title ?? document.name)}</title>
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

function renderArtboard(artboard: DesignArtboard, data: CredentialDesignData): string {
  const elements = artboard.elements
    .filter((element) => element.visible !== false)
    .map((element) => renderElement(element, data))
    .join('\n')
  return `<section class="ds-page" data-artboard="${esc(artboard.id)}" style="width:${artboard.width}in;height:${artboard.height}in;background:${esc(artboard.background)};">${elements}</section>`
}

function renderElement(element: DesignElement, data: CredentialDesignData): string {
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
    'display:flex',
    element.align === 'center'
      ? 'justify-content:center'
      : element.align === 'right'
        ? 'justify-content:flex-end'
        : 'justify-content:flex-start',
    'align-items:center',
  ].join(';')
}

function renderImage(element: ImageElement, data: CredentialDesignData, style: string): string {
  const src =
    element.source === 'tenant.logo'
      ? data.tenantLogoUrl
      : element.source === 'recipient.photo'
        ? data.recipientPhotoUrl
        : element.url
  const radius = element.radius ?? 0
  if (!src) {
    return `<div class="ds-el" style="${style}border:${0.01}in dashed #cbd5e1;border-radius:${radius}in;background:#f8fafc;color:#94a3b8;font-size:6pt;display:flex;align-items:center;justify-content:center;">${esc(element.name)}</div>`
  }
  return `<img class="ds-el ds-fit-${element.fit ?? 'contain'}" src="${esc(src)}" alt="" style="${style}border-radius:${radius}in;display:block;"/>`
}

function renderQr(
  element: Extract<DesignElement, { kind: 'qr' }>,
  data: CredentialDesignData,
  style: string,
): string {
  if (data.qrDataUrl) {
    return `<img class="ds-el" src="${esc(data.qrDataUrl)}" alt="" style="${style}background:${esc(element.background ?? '#fff')};padding:0.03in;"/>`
  }
  return `<div class="ds-el" style="${style}background:${esc(element.background ?? '#fff')};border:0.01in solid #cbd5e1;color:${esc(element.foreground ?? '#0f172a')};font-size:8pt;display:flex;align-items:center;justify-content:center;">QR</div>`
}

function renderSeal(
  element: Extract<DesignElement, { kind: 'seal' }>,
  data: CredentialDesignData,
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

function resolveField(element: DataFieldElement, data: CredentialDesignData): string {
  const raw = valueForField(element.field, data)
  let value = raw || element.fallback || ''
  if (element.transform === 'uppercase') value = value.toUpperCase()
  if (element.transform === 'date-long') value = formatDate(value, 'long')
  if (element.transform === 'date-short') value = formatDate(value, 'short')
  return `${element.prefix ?? ''}${value}${element.suffix ?? ''}`
}

export function valueForField(field: CredentialDataField, data: CredentialDesignData): string {
  switch (field) {
    case 'tenant.name':
      return data.tenantName
    case 'tenant.logo':
      return data.tenantLogoUrl ?? ''
    case 'recipient.fullName':
      return data.recipientFullName
    case 'recipient.employeeNo':
      return data.recipientEmployeeNo ?? ''
    case 'recipient.photo':
      return data.recipientPhotoUrl ?? ''
    case 'credential.name':
      return data.credentialName
    case 'credential.code':
      return data.credentialCode ?? ''
    case 'authority.name':
      return data.authorityName ?? ''
    case 'completedOn':
      return data.completedOn ?? ''
    case 'expiresOn':
      return data.expiresOn ?? ''
    case 'instructor':
      return data.instructor ?? ''
    case 'grade':
      return data.grade == null ? '' : `${data.grade}%`
    case 'verify.url':
      return data.verifyUrl ?? ''
    case 'verify.token':
      return data.verifyToken ?? ''
    case 'verify.qr':
      return data.qrDataUrl ?? ''
    case 'issuedAt':
      return data.issuedAt ? String(data.issuedAt) : ''
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
