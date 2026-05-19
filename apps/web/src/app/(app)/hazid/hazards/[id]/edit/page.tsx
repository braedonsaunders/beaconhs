import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { hazidHazardTypes, hazidHazards } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { deleteHazardLibrary, updateHazardLibrary } from '../../../_actions'

export const metadata = { title: 'Edit hazard' }
export const dynamic = 'force-dynamic'

async function update(formData: FormData) {
  'use server'
  await updateHazardLibrary(formData)
  const id = String(formData.get('id') ?? '')
  redirect(`/hazid/hazards/${id}`)
}

async function remove(formData: FormData) {
  'use server'
  await deleteHazardLibrary(formData)
  redirect('/hazid/hazards')
}

export default async function EditHazardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(hazidHazards).where(eq(hazidHazards.id, id)).limit(1)
    if (!row) return null
    const types = await tx
      .select({ id: hazidHazardTypes.id, name: hazidHazardTypes.name })
      .from(hazidHazardTypes)
      .orderBy(asc(hazidHazardTypes.name))
    return { row, types }
  })
  if (!data) notFound()
  const { row, types } = data
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader back={{ href: `/hazid/hazards/${id}`, label: 'Back' }} title="Edit hazard" />
        <Card>
          <CardContent className="pt-6">
            <form action={update} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" defaultValue={row.name} required />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select name="hazardTypeId" defaultValue={row.hazardTypeId ?? ''}>
                  <option value="">—</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={2} defaultValue={row.description ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Standard controls</Label>
                <Textarea name="standardControls" rows={4} defaultValue={row.standardControls ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Risks</Label>
                <Textarea name="risks" rows={2} defaultValue={row.risks ?? ''} />
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
                Delete hazard
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
