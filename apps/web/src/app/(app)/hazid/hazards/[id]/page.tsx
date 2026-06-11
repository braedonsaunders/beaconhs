import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { Badge, Button, DetailHeader } from '@beaconhs/ui'
import { hazidHazardTypes, hazidHazards } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'

export const dynamic = 'force-dynamic'

export default async function HazardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ h: hazidHazards, type: hazidHazardTypes })
      .from(hazidHazards)
      .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
      .where(eq(hazidHazards.id, id))
      .limit(1)
    return row
  })
  if (!data) notFound()
  const { h, type } = data
  return (
    <DetailPageLayout
      header={
        <>
          <div className="mb-2"></div>
          <DetailHeader
            back={{ href: '/hazid/hazards', label: 'Back to hazards' }}
            title={h.name}
            badge={
              type ? (
                <Badge variant="outline" style={{ borderColor: type.color, color: type.color }}>
                  {type.name}
                </Badge>
              ) : null
            }
            actions={
              <Link href={`/hazid/hazards?drawer=edit-hazard&id=${id}`} scroll={false}>
                <Button variant="outline">Edit</Button>
              </Link>
            }
          />
        </>
      }
    >
      <div className="space-y-5">
        <Section title="Overview" defaultOpen>
          <DetailGrid
            rows={[
              { label: 'Name', value: h.name },
              { label: 'Type', value: type?.name ?? '—' },
              { label: 'Description', value: h.description ?? '—' },
            ]}
          />
        </Section>
        <Section title="Standard controls" defaultOpen>
          <p className="text-sm whitespace-pre-wrap text-slate-900">{h.standardControls ?? '—'}</p>
        </Section>
        <Section title="Risks" defaultOpen>
          <p className="text-sm whitespace-pre-wrap text-slate-900">{h.risks ?? '—'}</p>
        </Section>
      </div>
    </DetailPageLayout>
  )
}
