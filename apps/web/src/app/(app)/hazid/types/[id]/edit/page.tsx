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
import { hazidAssessmentTypes, hazidHazardSets } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { deleteAssessmentType, updateAssessmentType } from '../../../_actions'

export const metadata = { title: 'Edit assessment type' }
export const dynamic = 'force-dynamic'

async function update(formData: FormData) {
  'use server'
  await updateAssessmentType(formData)
  const id = String(formData.get('id') ?? '')
  redirect(`/hazid/types/${id}`)
}

async function remove(formData: FormData) {
  'use server'
  await deleteAssessmentType(formData)
  redirect('/hazid/types')
}

export default async function EditAssessmentTypePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireModuleManage('hazid')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(hazidAssessmentTypes)
      .where(eq(hazidAssessmentTypes.id, id))
      .limit(1)
    if (!row) return null
    const sets = await tx
      .select({ id: hazidHazardSets.id, name: hazidHazardSets.name })
      .from(hazidHazardSets)
      .orderBy(asc(hazidHazardSets.name))
    return { row, sets }
  })
  if (!data) notFound()
  const { row, sets } = data
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader back={{ href: `/hazid/types/${id}`, label: 'Back' }} title="Edit assessment type" />
        <Card>
          <CardContent className="pt-6">
            <form action={update} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required defaultValue={row.name} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={2} defaultValue={row.description ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Style</Label>
                <Select name="style" defaultValue={row.style}>
                  <option value="task_based">Task-based</option>
                  <option value="hazard_based">Hazard-based</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Default hazard set</Label>
                <Select name="defaultHazardSetId" defaultValue={row.defaultHazardSetId ?? ''}>
                  <option value="">— none —</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
                <legend className="px-1 text-xs font-medium text-slate-500">Enable sub-sections</legend>
                <Check name="hasTasks" label="Tasks" defaultChecked={row.hasTasks} />
                <Check name="hasHazards" label="Hazards" defaultChecked={row.hasHazards} />
                <Check name="hasPPE" label="PPE" defaultChecked={row.hasPPE} />
                <Check name="hasQuestions" label="Questions & Answers" defaultChecked={row.hasQuestions} />
                <Check name="hasWAH" label="Fall Protection" defaultChecked={row.hasWAH} />
                <Check name="hasCS" label="Confined Space" defaultChecked={row.hasCS} />
                <Check name="hasArcFlash" label="Arc Flash" defaultChecked={row.hasArcFlash} />
              </fieldset>
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

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      {label}
    </label>
  )
}
