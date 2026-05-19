import { redirect } from 'next/navigation'
import { asc, eq, isNull } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { hazidHazardTypes, hazidHazards } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createHazardSet } from '../../../_actions'
import { MultiPicker } from '../../../_multipicker'

export const metadata = { title: 'New hazard set' }
export const dynamic = 'force-dynamic'

async function submit(formData: FormData) {
  'use server'
  await createHazardSet(formData)
  redirect('/hazid/hazards/sets')
}

export default async function NewHazardSetPage() {
  const ctx = await requireRequestContext()
  const hazards = await ctx.db((tx) =>
    tx
      .select({ id: hazidHazards.id, name: hazidHazards.name, typeName: hazidHazardTypes.name })
      .from(hazidHazards)
      .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
      .where(isNull(hazidHazards.deletedAt))
      .orderBy(asc(hazidHazards.name)),
  )
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader back={{ href: '/hazid/hazards/sets', label: 'Back' }} title="New hazard set" />
        <Card>
          <CardContent className="pt-6">
            <form action={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required placeholder="e.g. Outdoor work hazards" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Hazards in set</Label>
                <MultiPicker
                  name="hazardIds"
                  options={hazards.map((h) => ({ value: h.id, label: h.name, sublabel: h.typeName ?? undefined }))}
                  placeholder="Search hazards…"
                />
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">Create set</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
