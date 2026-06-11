import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
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
import { hazidHazardTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createHazardLibrary } from '../../_actions'

export const metadata = { title: 'New hazard' }
export const dynamic = 'force-dynamic'

async function submit(formData: FormData) {
  'use server'
  await createHazardLibrary(formData)
  redirect('/hazid/hazards')
}

export default async function NewHazardPage() {
  const ctx = await requireRequestContext()
  const types = await ctx.db((tx) =>
    tx
      .select({ id: hazidHazardTypes.id, name: hazidHazardTypes.name })
      .from(hazidHazardTypes)
      .orderBy(asc(hazidHazardTypes.name)),
  )
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/hazid/hazards', label: 'Back to hazards' }}
          title="New hazard"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required placeholder="e.g. Pinch point" />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select name="hazardTypeId" defaultValue="">
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
                <Textarea name="description" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Standard controls (canonical wording)</Label>
                <Textarea
                  name="standardControls"
                  rows={4}
                  placeholder="What is the default mitigation?"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Risks (what could go wrong)</Label>
                <Textarea name="risks" rows={2} />
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">Create hazard</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
