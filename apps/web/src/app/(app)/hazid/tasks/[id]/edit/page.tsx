import { notFound, redirect } from 'next/navigation'
import { asc, eq, isNull } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { hazidHazardTypes, hazidHazards, hazidTasks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { deleteTaskLibrary, updateTaskLibrary } from '../../../_actions'
import { MultiPicker } from '../../../_multipicker'

export const metadata = { title: 'Edit task' }
export const dynamic = 'force-dynamic'

async function update(formData: FormData) {
  'use server'
  await updateTaskLibrary(formData)
  redirect('/hazid/tasks')
}

async function remove(formData: FormData) {
  'use server'
  await deleteTaskLibrary(formData)
  redirect('/hazid/tasks')
}

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(hazidTasks).where(eq(hazidTasks.id, id)).limit(1)
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
        <DetailHeader back={{ href: '/hazid/tasks', label: 'Back' }} title="Edit task" />
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
                <Textarea name="description" rows={3} defaultValue={row.description ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Default controls</Label>
                <Textarea name="controls" rows={3} defaultValue={row.controls ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Linked hazards</Label>
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
                Delete task
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
