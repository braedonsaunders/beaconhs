// GET /journals/:id/print — a self-contained printable HTML document (bypasses
// the app shell). The user prints it to PDF from the browser. Auth-scoped.

import { requireRequestContext } from '@/lib/auth'
import { getEntry } from '../../_data'
import { formatLongDate } from '../../_format'

export const dynamic = 'force-dynamic'

function esc(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const ctx = await requireRequestContext()
  const entry = await getEntry(ctx, id)
  if (!entry) return new Response('Not found', { status: 404 })

  const photos = entry.photos
    .filter((p) => p.url)
    .map(
      (p) =>
        `<figure style="margin:0;break-inside:avoid"><img src="${esc(p.url)}" style="width:100%;border-radius:6px;border:1px solid #e2e8f0"/>${
          p.caption ? `<figcaption style="font-size:11px;color:#64748b;margin-top:4px">${esc(p.caption)}</figcaption>` : ''
        }</figure>`,
    )
    .join('')

  const tags = entry.tags
    .map((t) => `<span style="background:#f1f5f9;border-radius:9999px;padding:2px 8px;font-size:11px;color:#475569">${esc(t)}</span>`)
    .join(' ')

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(entry.title ?? 'Journal entry')} · ${esc(entry.reference)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  *{box-sizing:border-box} body{font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:760px;margin:32px auto;padding:0 24px;line-height:1.6}
  h1{font-size:24px;margin:0 0 4px} .meta{color:#64748b;font-size:13px;margin-bottom:4px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
  .body{font-size:15px} .body img{max-width:100%}
  .toolbar{margin:0 0 20px;padding-bottom:16px;border-bottom:1px solid #e2e8f0}
  button{font:inherit;background:#0f766e;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer}
  @media print{.toolbar{display:none}body{margin:0}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <h1>${esc(entry.title ?? 'Untitled entry')}</h1>
  <div class="meta">${esc(entry.reference)} · ${esc(formatLongDate(entry.entryDate))}</div>
  <div class="meta">${esc(entry.authorName ?? '')}${entry.siteName ? ` · ${esc(entry.siteName)}` : ''} · ${esc(entry.definition)} · ${esc(entry.status)}</div>
  ${tags ? `<div style="margin:10px 0">${tags}</div>` : ''}
  ${entry.summary ? `<p style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:10px 12px;font-size:13px;color:#0f766e">${esc(entry.summary)}</p>` : ''}
  <div class="body">${entry.bodyHtml || '<p style="color:#94a3b8">No content.</p>'}</div>
  ${photos ? `<div class="grid">${photos}</div>` : ''}
</body></html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}
