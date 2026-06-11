import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import { Button, DetailHeader } from '@beaconhs/ui'
import { equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `QR · ${id.slice(0, 8)}` }
}

export default async function EquipmentQrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({ item: equipmentItems, type: equipmentTypes })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .where(eq(equipmentItems.id, id))
      .limit(1)
    return r ?? null
  })
  if (!row) notFound()

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
  const scanUrl = `${appUrl}/equipment/scan/${row.item.qrToken}`
  const svg = await QRCode.toString(scanUrl, {
    type: 'svg',
    margin: 1,
    width: 360,
    color: { dark: '#0f172a', light: '#ffffff' },
  })

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-5">
        <DetailHeader
          back={{ href: `/equipment/${id}`, label: 'Back to equipment' }}
          title={`QR label — ${row.item.name}`}
          subtitle={`${row.item.assetTag}${row.type ? ` · ${row.type.name}` : ''}`}
          actions={
            <Button asChild variant="outline">
              <a
                href={`/equipment/${id}/qr/print`}
                target="_blank"
                rel="noreferrer"
                title="Open the print sheet"
              >
                Print sheet
              </a>
            </Button>
          }
        />

        <div className="rounded-lg border border-slate-200 bg-white p-8 print:border-0">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:items-center">
            <div className="flex items-center justify-center">
              <div
                className="w-72"
                aria-label={`QR code for ${row.item.name}`}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs tracking-wide text-slate-500 uppercase">Asset tag</div>
                <div className="font-mono text-2xl font-semibold">{row.item.assetTag}</div>
              </div>
              <div>
                <div className="text-xs tracking-wide text-slate-500 uppercase">Name</div>
                <div className="text-lg">{row.item.name}</div>
              </div>
              {row.type ? (
                <div>
                  <div className="text-xs tracking-wide text-slate-500 uppercase">Type</div>
                  <div>{row.type.name}</div>
                </div>
              ) : null}
              {row.item.serialNumber ? (
                <div>
                  <div className="text-xs tracking-wide text-slate-500 uppercase">Serial</div>
                  <div className="font-mono text-sm">{row.item.serialNumber}</div>
                </div>
              ) : null}
              <div className="pt-3 text-xs text-slate-500">
                Scan to verify, log pre-use inspection, or transfer location.
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-600">
          <div className="font-medium text-slate-800">Scan URL</div>
          <div className="mt-1 font-mono text-xs break-all">{scanUrl}</div>
          <div className="mt-3">
            <Link href={scanUrl} className="text-teal-700 hover:underline">
              Try it
            </Link>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
