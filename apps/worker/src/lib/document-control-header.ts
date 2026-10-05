import type { DocumentControlHeader } from '@beaconhs/db/schema'
import { resolveHexColor } from '@beaconhs/forms-pdf'

export function documentAccentColor(primaryColor?: string | null): string {
  return resolveHexColor(primaryColor, '#0f172a')
}

function titleInk(accent: string): string {
  const raw = accent.slice(1)
  const hex = raw.length === 3 ? [...raw].map((digit) => digit + digit).join('') : raw
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  return luminance > 0.179 ? '#000' : '#fff'
}

type HeaderFields = Omit<
  DocumentControlHeader,
  'issuedAt' | 'revisedAt' | 'category' | 'type' | 'approvedBy'
> & {
  category?: string | null
  type?: string | null
  approvedBy?: string | null
  issuedAt?: Date | string | null
  revisedAt?: Date | string | null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function formatHeaderDate(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return '—'
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: dateOnly ? 'UTC' : timeZone,
  }).format(new Date(value))
}

export function documentControlHeaderHtml(
  entry: HeaderFields,
  accent: string,
  timeZone: string,
  ownPage: boolean,
): string {
  const pad = ownPage ? '6px 10px' : '3px 8px'
  const titleFont = ownPage ? 21 : entry.title.length > 80 ? 11 : 15
  const categoryFont = ownPage || (entry.category?.length ?? 0) <= 60 ? 11 : 9
  const cell = `border:1px solid #0f172a;padding:${pad};font-size:${ownPage ? 11 : 9}px;vertical-align:middle;overflow-wrap:anywhere;`
  const label = `${cell}width:22%;letter-spacing:.06em;text-transform:uppercase;color:#334155;`
  const value = `${cell}width:36%;`
  return `
    <div style="padding-top:${ownPage ? 48 : 0}px">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup><col style="width:42%"><col style="width:22%"><col style="width:36%"></colgroup>
        <tbody>
          <tr>
            <td style="${cell}text-transform:uppercase;letter-spacing:.06em;color:#334155;font-size:${categoryFont}px;">${escapeHtml(entry.category ?? '')}</td>
            <td style="${label}">Issue date</td>
            <td style="${value}">${escapeHtml(formatHeaderDate(entry.issuedAt, timeZone))}</td>
          </tr>
          <tr>
            <td rowspan="4" style="${cell}background:${accent};color:${titleInk(accent)};font-size:${titleFont}px;font-weight:700;line-height:1.2;">${escapeHtml(entry.title)}</td>
            <td style="${label}">Revision date</td>
            <td style="${value}">${escapeHtml(formatHeaderDate(entry.revisedAt, timeZone))}</td>
          </tr>
          <tr>
            <td style="${label}">Approved by</td>
            <td style="${value}">${escapeHtml(entry.approvedBy ?? '—')}</td>
          </tr>
          <tr>
            <td style="${label}">Version</td>
            <td style="${value}">${escapeHtml(String(entry.version))}</td>
          </tr>
          <tr>
            <td colspan="2" style="${cell}text-align:center;text-transform:uppercase;letter-spacing:.06em;color:#334155;">${escapeHtml(entry.type ?? '')}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin-top:${ownPage ? 14 : 5}px;font-size:${ownPage ? 10 : 8}px;color:#64748b;letter-spacing:.04em;">${escapeHtml(entry.key)}</p>
    </div>`
}
