// Server-side renderers for a brief run: email HTML, printable PDF body, and
// plain text. The in-app view renders the same structured result in React.
// Every value is escaped — nothing from the model is trusted as markup.

import type { BriefEvidence, BriefResult } from '@beaconhs/db/schema'

export type BriefRenderInput = {
  briefName: string
  tenantName: string
  logoUrl: string | null
  accentColor: string | null
  result: BriefResult
  evidence: BriefEvidence
  /** Absolute app origin for record and run links. */
  appUrl: string
  runPath: string
  generatedAt: Date
  modelLabel: string | null
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SAFE_COLOR = /^#[0-9a-f]{6}$/i

function accent(input: BriefRenderInput): string {
  return input.accentColor && SAFE_COLOR.test(input.accentColor) ? input.accentColor : '#0d9488'
}

function recordUrl(input: BriefRenderInput, ref: string): string | null {
  const record = input.evidence.records.find((r) => r.ref === ref)
  return record ? `${input.appUrl}${record.path}` : null
}

function citationLinks(input: BriefRenderInput, refs: string[], color: string): string {
  if (refs.length === 0) return ''
  return ` <span style="white-space:nowrap;">${refs
    .map((ref) => {
      const url = recordUrl(input, ref)
      const label = escapeHtml(ref)
      return url
        ? `<a href="${escapeHtml(url)}" style="color:${color};font-size:11px;text-decoration:none;font-weight:600;">${label}</a>`
        : `<span style="color:#94a3b8;font-size:11px;">${label}</span>`
    })
    .join(' ')}</span>`
}

/** Headline figures: facts without breakdowns, capped for a tidy row. */
function headlineFacts(evidence: BriefEvidence) {
  return evidence.facts.filter((f) => !f.items).slice(0, 4)
}

function breakdownFacts(evidence: BriefEvidence) {
  return evidence.facts.filter((f) => f.items && f.items.length > 0)
}

function body(input: BriefRenderInput, variant: 'email' | 'pdf'): string {
  const color = accent(input)
  const { result, evidence } = input
  const facts = headlineFacts(evidence)
  const tiles = facts.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 18px;"><tr>${facts
        .map(
          (f) =>
            `<td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;vertical-align:top;"><div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;">${escapeHtml(f.label)}</div><div style="font-size:24px;font-weight:700;color:#0f172a;margin-top:4px;">${escapeHtml(f.value)}</div></td>`,
        )
        .join('')}</tr></table>`
    : ''
  const breakdowns = breakdownFacts(evidence)
    .map(
      (f) =>
        `<div style="margin:0 0 14px;"><div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">${escapeHtml(f.label)}</div>${(
          f.items ?? []
        )
          .slice(0, 24)
          .map(
            (item) =>
              `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:999px;background:#f1f5f9;color:#0f172a;font-size:12px;">${escapeHtml(item.label)}${item.value ? ` <strong>${escapeHtml(item.value)}</strong>` : ''}</span>`,
          )
          .join('')}</div>`,
    )
    .join('')
  const notice = result.notice
    ? `<div style="margin:0 0 16px;padding:10px 12px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:13px;">${escapeHtml(result.notice)}</div>`
    : ''
  const summary = result.summary
    ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#1f2937;">${escapeHtml(result.summary)}</p>`
    : ''
  const sections = result.sections
    .filter((s) => s.bullets.length > 0)
    .map(
      (s) =>
        `<h2 style="margin:22px 0 8px;font-size:16px;color:#0f172a;border-bottom:2px solid ${color};padding-bottom:4px;">${escapeHtml(s.title)}</h2><ul style="margin:0;padding-left:20px;">${s.bullets
          .map(
            (b) =>
              `<li style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#1f2937;">${escapeHtml(b.text)}${citationLinks(input, b.citations, color)}</li>`,
          )
          .join('')}</ul>`,
    )
    .join('')
  const changes = result.changes.length
    ? `<h2 style="margin:22px 0 8px;font-size:16px;color:#0f172a;border-bottom:2px solid ${color};padding-bottom:4px;">What changed</h2><ul style="margin:0;padding-left:20px;">${result.changes
        .map(
          (c) => `<li style="margin:0 0 6px;font-size:14px;color:#1f2937;">${escapeHtml(c)}</li>`,
        )
        .join('')}</ul>`
    : ''
  const followUps = result.followUps.length
    ? `<h2 style="margin:22px 0 8px;font-size:16px;color:#0f172a;border-bottom:2px solid ${color};padding-bottom:4px;">Follow-ups</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">${result.followUps
        .map(
          (f) =>
            `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;width:70px;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${f.priority === 'high' ? '#fee2e2' : f.priority === 'medium' ? '#fef3c7' : '#e0f2fe'};color:#0f172a;">${escapeHtml(f.priority.toUpperCase())}</span></td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#1f2937;">${escapeHtml(f.action)}${f.owner ? ` <span style="color:#64748b;">— ${escapeHtml(f.owner)}</span>` : ''}${citationLinks(input, f.citations, color)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
  const cited = new Set([
    ...result.sections.flatMap((s) => s.bullets.flatMap((b) => b.citations)),
    ...result.followUps.flatMap((f) => f.citations),
  ])
  const sources = evidence.records.filter((r) => cited.has(r.ref))
  const sourceList = sources.length
    ? `<h2 style="margin:26px 0 8px;font-size:13px;color:#475569;text-transform:uppercase;letter-spacing:.06em;">Sources</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;color:#334155;">${sources
        .map(
          (r) =>
            `<tr><td style="padding:3px 8px 3px 0;vertical-align:top;font-weight:700;color:${color};width:44px;">${escapeHtml(r.ref)}</td><td style="padding:3px 0;"><a href="${escapeHtml(`${input.appUrl}${r.path}`)}" style="color:#0f172a;text-decoration:none;">${escapeHtml(r.title)}</a> <span style="color:#64748b;">· ${escapeHtml(r.date)}${r.author ? ` · ${escapeHtml(r.author)}` : ''}${r.department ? ` · ${escapeHtml(r.department)}` : ''}</span></td></tr>`,
        )
        .join('')}</table>`
    : ''
  const scope = evidence.scope.departmentName
    ? ` · ${escapeHtml(evidence.scope.departmentName)}`
    : ''
  const logo =
    input.logoUrl && variant === 'pdf'
      ? `<img src="${escapeHtml(input.logoUrl)}" alt="" style="height:36px;max-width:180px;object-fit:contain;margin-bottom:10px;" />`
      : ''
  const header = `<div style="background:#0f172a;color:#f8fafc;padding:24px 28px;${variant === 'email' ? 'border-radius:16px 16px 0 0;' : ''}">${logo}<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color};">${escapeHtml(input.tenantName)} · AI brief</div><div style="font-size:24px;font-weight:700;margin-top:6px;line-height:1.2;">${escapeHtml(input.briefName)}</div><div style="font-size:13px;color:#cbd5e1;margin-top:6px;">${escapeHtml(evidence.window.label)}${scope}</div></div>`
  const headline = `<p style="margin:0 0 14px;font-size:18px;font-weight:700;line-height:1.4;color:#0f172a;">${escapeHtml(result.headline)}</p>`
  const footer = `<p style="margin:26px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">Written by AI from ${evidence.records.length} record(s)${input.modelLabel ? ` with ${escapeHtml(input.modelLabel)}` : ''}. Figures are computed exactly; review the cited records before acting.${variant === 'email' ? ` <a href="${escapeHtml(`${input.appUrl}${input.runPath}`)}" style="color:${color};">Open in BeaconHS</a>` : ''}</p>`
  return `${header}<div style="padding:22px 28px 28px;background:#ffffff;${variant === 'email' ? 'border-radius:0 0 16px 16px;' : ''}">${notice}${headline}${tiles}${summary}${breakdowns}${sections}${changes}${followUps}${sourceList}${footer}</div>`
}

export function renderBriefEmailHtml(input: BriefRenderInput): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.briefName)}</title></head><body style="margin:0;padding:24px 0;background:#f1f5f9;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;"><div style="max-width:760px;margin:0 auto;padding:0 12px;"><div style="box-shadow:0 10px 30px rgba(15,23,42,.08);border-radius:16px;">${body(input, 'email')}</div></div></body></html>`
}

/** Body HTML for renderHtmlDocumentPdf (no letterhead chrome of its own). */
export function renderBriefPdfBody(input: BriefRenderInput): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">${body(input, 'pdf')}</div>`
}

export function renderBriefText(input: BriefRenderInput): string {
  const { result, evidence } = input
  const lines: string[] = [
    `${input.briefName} — ${evidence.window.label}${evidence.scope.departmentName ? ` · ${evidence.scope.departmentName}` : ''}`,
    '',
  ]
  if (result.notice) lines.push(`Note: ${result.notice}`, '')
  lines.push(result.headline, '')
  for (const fact of evidence.facts) {
    lines.push(`${fact.label}: ${fact.value}`)
    for (const item of fact.items?.slice(0, 24) ?? []) {
      lines.push(`  - ${item.label}${item.value ? `: ${item.value}` : ''}`)
    }
  }
  if (result.summary) lines.push('', result.summary)
  for (const section of result.sections) {
    if (section.bullets.length === 0) continue
    lines.push('', section.title.toUpperCase())
    for (const bullet of section.bullets) {
      lines.push(
        `- ${bullet.text}${bullet.citations.length ? ` [${bullet.citations.join(', ')}]` : ''}`,
      )
    }
  }
  if (result.changes.length) {
    lines.push('', 'WHAT CHANGED', ...result.changes.map((c) => `- ${c}`))
  }
  if (result.followUps.length) {
    lines.push('', 'FOLLOW-UPS')
    for (const f of result.followUps) {
      lines.push(`- [${f.priority}] ${f.action}${f.owner ? ` — ${f.owner}` : ''}`)
    }
  }
  lines.push('', `Open in BeaconHS: ${input.appUrl}${input.runPath}`)
  return lines.join('\n')
}
