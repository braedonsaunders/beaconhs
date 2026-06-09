import { redirect } from 'next/navigation'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { createHazardType } from '../../../_actions'

export const metadata = { title: 'New hazard type' }

async function submit(formData: FormData) {
  'use server'
  await createHazardType(formData)
  redirect('/hazid/hazards/types')
}

export default async function NewHazardTypePage() {
  await requireModuleManage('hazid')
  return (
    <PageContainer>
      <div className="max-w-xl space-y-6">
        <DetailHeader back={{ href: '/hazid/hazards/types', label: 'Back' }} title="New hazard type" />
        <Card>
          <CardContent className="pt-6">
            <form action={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required placeholder="e.g. Mechanical" />
              </div>
              <div className="space-y-1.5">
                <Label>Color (hex)</Label>
                <Input name="color" defaultValue="#64748b" placeholder="#dc2626" />
              </div>
              <div className="space-y-1.5">
                <Label>Icon key (Lucide)</Label>
                <Input name="iconKey" placeholder="e.g. zap, flame, hammer" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={3} />
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">Create type</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
