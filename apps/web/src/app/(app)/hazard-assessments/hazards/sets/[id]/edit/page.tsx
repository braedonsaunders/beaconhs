import { notFound, redirect } from 'next/navigation'
import { asc, eq, isNull } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { hazidHazardSets, hazidHazardTypes, hazidHazards } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { deleteHazardSet, updateHazardSet } from '../../../../_actions'
import { MultiPicker } from '../../../../_multipicker'

export const metadata = { title: 'Edit hazard set' }
export const dynamic = 'force-dynamic'

async function update(formData: FormData) {
  'use server'
  await updateHazardSet(formData)
  redirect('/hazard-assessments/hazards/sets')
}

async function remove(formData: FormData) {
  'use server'
  await deleteHazardSet(formData)
  redirect('/hazard-assessments/hazards/sets')
}

export default async function EditHazardSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireModuleManage('hazid')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(hazidHazardSets).where(eq(hazidHazardSets.id, id)).limit(1)
    if (!row) return null
    const hazards = await tx
      .select({ id: hazidHazards.id, name: hazidHazards.name, typeName: hazidHazardTypes.name })
      .from(hazidHazards)
      .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
      .where(isNull(hazidHazards.deletedAt))
      .orderBy(asc(hazidHazards.name))
    return { row, hazards }
  })
  if (!data) notFound()
  const { row, hazards } = data
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/hazard-assessments/hazards/sets', label: 'Back' }}
          title="Edit hazard set"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={update} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" defaultValue={row.name} required />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={2} defaultValue={row.description ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Hazards in set</Label>
                <MultiPicker
                  name="hazardIds"
                  defaultSelected={row.hazardIds}
                  options={hazards.map((h) => ({
                    value: h.id,
                    label: h.name,
                    sublabel: h.typeName ?? undefined,
                  }))}
                />
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">Save</Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold text-red-700">Danger zone</h2>
            <form action={remove}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="outline" className="text-red-600 hover:bg-red-50">
                Delete set
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
