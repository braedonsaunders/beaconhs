import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { hazidHazardTypes } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { deleteHazardType, updateHazardType } from '../../../../_actions'

export const metadata = { title: 'Edit hazard type' }
export const dynamic = 'force-dynamic'

async function update(formData: FormData) {
  'use server'
  await updateHazardType(formData)
  redirect('/hazid/hazards/types')
}

async function remove(formData: FormData) {
  'use server'
  await deleteHazardType(formData)
  redirect('/hazid/hazards/types')
}

export default async function EditHazardTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireModuleManage('hazid')
  const [row] = await ctx.db((tx) =>
    tx.select().from(hazidHazardTypes).where(eq(hazidHazardTypes.id, id)).limit(1),
  )
  if (!row) notFound()
  return (
    <PageContainer>
      <div className="max-w-xl space-y-6">
        <DetailHeader
          back={{ href: '/hazid/hazards/types', label: 'Back' }}
          title="Edit hazard type"
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
                <Label>Color (hex)</Label>
                <Input name="color" defaultValue={row.color} />
              </div>
              <div className="space-y-1.5">
                <Label>Icon key</Label>
                <Input name="iconKey" defaultValue={row.iconKey ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={3} defaultValue={row.description ?? ''} />
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
                Delete type
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
