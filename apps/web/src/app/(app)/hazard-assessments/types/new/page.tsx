import { redirect } from 'next/navigation'
import { asc, isNull } from 'drizzle-orm'
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
import { hazidHazardSets, personGroups } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { createAssessmentType } from '../../_actions'
import { MultiPicker } from '../../_multipicker'

export const metadata = { title: 'New assessment type' }
export const dynamic = 'force-dynamic'

async function submit(formData: FormData) {
  'use server'
  await createAssessmentType(formData)
  redirect('/hazard-assessments/types')
}

export default async function NewAssessmentTypePage() {
  const ctx = await requireModuleManage('hazid')
  const { sets, groups } = await ctx.db(async (tx) => {
    const sets = await tx
      .select({ id: hazidHazardSets.id, name: hazidHazardSets.name })
      .from(hazidHazardSets)
      .orderBy(asc(hazidHazardSets.name))
    const groups = await tx
      .select({ id: personGroups.id, name: personGroups.name })
      .from(personGroups)
      .where(isNull(personGroups.deletedAt))
      .orderBy(asc(personGroups.name))
    return { sets, groups }
  })
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/hazard-assessments/types', label: 'Back' }}
          title="New assessment type"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required placeholder="e.g. Standard hazard assessment" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Style</Label>
                <Select name="style" defaultValue="task_based">
                  <option value="task_based">Task-based (tasks first, then hazards)</option>
                  <option value="hazard_based">
                    Hazard-based (hazards first, with job-scope summary)
                  </option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Default hazard set</Label>
                <Select name="defaultHazardSetId" defaultValue="">
                  <option value="">— none —</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <legend className="px-1 text-xs font-medium text-slate-500">
                  Enable sub-sections
                </legend>
                <CheckRow name="hasTasks" label="Tasks" defaultChecked />
                <CheckRow name="hasHazards" label="Hazards" defaultChecked />
                <CheckRow name="hasPPE" label="PPE" defaultChecked />
                <CheckRow name="hasQuestions" label="Questions & Answers" defaultChecked />
                <CheckRow name="hasWAH" label="Fall Protection (Working at Heights)" />
              </fieldset>
              {groups.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>Available to (person groups)</Label>
                  <p className="text-xs text-slate-500">
                    Leave empty to offer this type to everyone; pick groups to restrict who can
                    start one.
                  </p>
                  <MultiPicker
                    name="availableToGroupIds"
                    options={groups.map((g) => ({ value: g.id, label: g.name }))}
                  />
                </div>
              ) : null}
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

function CheckRow({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
      />
      {label}
    </label>
  )
}
