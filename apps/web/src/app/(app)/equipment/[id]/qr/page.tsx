import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import QRCode from 'qrcode'
import { Button, DetailHeader } from '@beaconhs/ui'
import { equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { appBaseUrl } from '@/lib/app-base-url'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { isUuid } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_1d63957988eac1', { value0: id.slice(0, 8) }) }
}

export default async function EquipmentQrPage({ params }: { params: Promise<{ id: string }> }) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const ctx = await requireRequestContext()
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({ item: equipmentItems, type: equipmentTypes })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .where(and(eq(equipmentItems.id, id), isNull(equipmentItems.deletedAt)))
      .limit(1)
    if (!r) return null
    // Same read-tier guard as the item detail page — the label exposes the
    // name, serial, and a working scan URL.
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      siteId: r.item.currentSiteOrgUnitId,
      personId: r.item.currentHolderPersonId,
    })
    return visible ? r : null
  })
  if (!row) notFound()

  const scanUrl = `${appBaseUrl()}/equipment/scan/${row.item.qrToken}`
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
          title={tGenerated('m_1bd9fcc355c45a', { value0: row.item.name })}
          subtitle={tGeneratedValue(`${row.item.assetTag}${row.type ? ` · ${row.type.name}` : ''}`)}
          actions={
            <Button asChild variant="outline" title={tGenerated('m_055217343f2cbe')}>
              <a href={`/equipment/${id}/qr/pdf`} target="_blank" rel="noopener noreferrer">
                <GeneratedText id="m_04aed76b78cb4a" />
              </a>
            </Button>
          }
        />

        <div className="rounded-lg border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900 print:border-0">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:items-center">
            <div className="flex items-center justify-center">
              {/* The QR tile stays on white so scanners read it in dark mode too. */}
              <div
                className="w-full max-w-72 rounded-md bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
                aria-label={tGenerated('m_1ca73787528309', { value0: row.item.name })}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <GeneratedText id="m_0d9ccb155777db" />
                </div>
                <div className="font-mono text-2xl font-semibold dark:text-slate-100">
                  <GeneratedValue value={row.item.assetTag} />
                </div>
              </div>
              <div>
                <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <GeneratedText id="m_02b18d5c7f6f2d" />
                </div>
                <div className="text-lg dark:text-slate-100">
                  <GeneratedValue value={row.item.name} />
                </div>
              </div>
              <GeneratedValue
                value={
                  row.type ? (
                    <div>
                      <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                        <GeneratedText id="m_074ba2f160c506" />
                      </div>
                      <div className="dark:text-slate-200">
                        <GeneratedValue value={row.type.name} />
                      </div>
                    </div>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  row.item.serialNumber ? (
                    <div>
                      <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                        <GeneratedText id="m_1365d9cb50ba5f" />
                      </div>
                      <div className="font-mono text-sm dark:text-slate-200">
                        <GeneratedValue value={row.item.serialNumber} />
                      </div>
                    </div>
                  ) : null
                }
              />
              <div className="pt-3 text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_19981785e9f8dd" />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
          <div className="font-medium text-slate-800 dark:text-slate-100">
            <GeneratedText id="m_1686561a46957f" />
          </div>
          <div className="mt-1 font-mono text-xs break-all">
            <GeneratedValue value={scanUrl} />
          </div>
          <div className="mt-3">
            <Link href={scanUrl} className="text-teal-700 hover:underline dark:text-teal-400">
              <GeneratedText id="m_05f2766626d94e" />
            </Link>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
