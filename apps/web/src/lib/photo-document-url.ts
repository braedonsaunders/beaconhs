import type { Annotation } from '@beaconhs/db/schema'

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;')
}

function annotationSvg(annotation: Annotation): string {
  switch (annotation.type) {
    case 'free':
      return `<polyline points="${annotation.points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${escapeXml(annotation.color)}" stroke-width="${annotation.width}" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'arrow':
      return `<line x1="${annotation.from[0]}" y1="${annotation.from[1]}" x2="${annotation.to[0]}" y2="${annotation.to[1]}" stroke="${escapeXml(annotation.color)}" stroke-width="${annotation.width}" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'circle':
      return `<circle cx="${annotation.cx}" cy="${annotation.cy}" r="${annotation.r}" fill="none" stroke="${escapeXml(annotation.color)}" stroke-width="${annotation.width}"/>`
    case 'rect':
      return `<rect x="${annotation.x}" y="${annotation.y}" width="${annotation.w}" height="${annotation.h}" fill="none" stroke="${escapeXml(annotation.color)}" stroke-width="${annotation.width}"/>`
    case 'text':
      return `<text x="${annotation.x}" y="${annotation.y}" fill="${escapeXml(annotation.color)}" font-size="${annotation.size}">${escapeXml(annotation.text)}</text>`
  }
}

/**
 * Wrap a private, short-lived image URL in a self-contained SVG when the user
 * added markup. Chromium resolves the nested signed URL while rendering the
 * PDF, so exports show the same non-destructive annotation layer as the UI.
 */
export function photoDocumentUrl(args: {
  url: string
  annotations: Annotation[] | null
  width: number | null
  height: number | null
}): string {
  if (!args.annotations?.length) return args.url
  const width = args.width && args.width > 0 ? args.width : 1_000
  const height = args.height && args.height > 0 ? args.height : 1_000
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 1000 1000" preserveAspectRatio="none">` +
    `<image href="${escapeXml(args.url)}" x="0" y="0" width="1000" height="1000" preserveAspectRatio="none"/>` +
    args.annotations.map(annotationSvg).join('') +
    `</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
