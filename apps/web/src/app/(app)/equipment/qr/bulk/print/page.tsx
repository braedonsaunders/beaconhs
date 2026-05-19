import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { asc, inArray } from 'drizzle-orm'
import QRCode from 'qrcode'
import { equipmentItems } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const metadata = { title: 'Bulk QR sheet' }
export const dynamic = 'force-dynamic'

function pickStrings(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => x.split(',').filter(Boolean))
  if (typeof v === 'string') return v.split(',').filter(Boolean)
  return []
}

/**
 * Server-rendered print-ready QR sheet — a 4×3 grid (12 labels per A4 page)
 * with the asset tag, name, type-name, and scan URL beneath each code.
 * Pure server-side: hits /print directly with `?ids=…` and pipes a fresh QR
 * SVG per item via the `qrcode` lib.
 */
export default async function BulkQrPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ids = pickStrings(sp.ids)
  if (ids.length === 0) {
    return (
      <div className="p-12 text-center">
        <p className="text-slate-600">
          No equipment selected. Go back to{' '}
          <a href="/equipment/qr/bulk" className="text-teal-700 underline">
            the bulk QR picker
          </a>
          .
        </p>
      </div>
    )
  }

  const ctx = await requireRequestContext()
  const bulkToken = randomBytes(8).toString('base64url')

  const items = await ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(equipmentItems)
      .where(inArray(equipmentItems.id, ids))
      .orderBy(asc(equipmentItems.assetTag))
    // Stamp the bulk-QR token + timestamp so re-printing a sheet can be
    // traced back through the audit log.
    if (rows.length > 0) {
      await tx
        .update(equipmentItems)
        .set({ bulkQrToken: bulkToken, bulkQrGeneratedAt: new Date() })
        .where(inArray(equipmentItems.id, rows.map((r) => r.id)))
    }
    return rows
  })

  await recordAudit(ctx, {
    entityType: 'equipment_item',
    action: 'export',
    summary: `Generated bulk QR sheet for ${items.length} items`,
    metadata: { bulkToken, itemIds: items.map((i) => i.id) },
  })
  revalidatePath('/equipment/qr/bulk')

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
  const labels = await Promise.all(
    items.map(async (item) => {
      const scanUrl = `${appUrl}/equipment/scan/${item.qrToken}`
      const svg = await QRCode.toString(scanUrl, {
        type: 'svg',
        margin: 0,
        width: 220,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
      return { item, scanUrl, svg }
    }),
  )

  return (
    <div className="min-h-screen bg-white p-6 print:p-0">
      <style>{`
        @page { size: A4; margin: 0.5in; }
        .qr-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.25in;
        }
        .qr-label {
          break-inside: avoid;
          page-break-inside: avoid;
          border: 1px dashed #cbd5e1;
          padding: 0.15in;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          text-align: center;
          font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        .qr-label svg { width: 1.6in; height: 1.6in; }
        .qr-tag { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #475569; margin-top: 4px; }
        .qr-name { font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px; line-height: 1.2; }
        .qr-url { font-size: 8px; color: #94a3b8; margin-top: 4px; word-break: break-all; }
        @media print { .no-print { display: none; } }
      `}</style>
      <div className="no-print mb-4 flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
        <div>
          <span className="font-medium">Bulk QR sheet</span> · {items.length} labels · token{' '}
          <code className="font-mono text-xs">{bulkToken}</code>
        </div>
        <div className="flex items-center gap-2">
          <a href="/equipment/qr/bulk" className="text-teal-700 hover:underline">
            Back
          </a>
          <button
            type="button"
            onClick={undefined}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-white"
            // Falls back to the browser print dialog via the inline script below.
            // We avoid client components in this leaf to keep the page server-only.
            data-print
          >
            Print
          </button>
        </div>
      </div>
      <div className="qr-grid">
        {labels.map(({ item, scanUrl, svg }) => (
          <div key={item.id} className="qr-label">
            <div dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="qr-tag">{item.assetTag}</div>
            <div className="qr-name">{item.name}</div>
            <div className="qr-url">{scanUrl}</div>
          </div>
        ))}
      </div>
      {/* Trigger window.print via a tiny inline script — keeps the page a
          pure server component. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.addEventListener('click', (e) => {
            const t = e.target instanceof Element ? e.target : null;
            if (t && t.closest('[data-print]')) window.print();
          });`,
        }}
      />
    </div>
  )
}
