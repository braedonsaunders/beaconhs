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
import { trainingCourses } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { createAssessmentType } from '../../../_actions/assessment-types'

export const metadata = { title: 'New assessment type' }

export default async function NewAssessmentTypePage() {
  const ctx = await requireModuleManage('training')
  const courses = await ctx.db(async (tx) =>
    tx.select().from(trainingCourses).orderBy(asc(trainingCourses.name)),
  )

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/training/assessments/types', label: 'Back to assessment types' }}
          title="New assessment type"
          subtitle="Create the quiz template, then add questions on the detail page."
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createAssessmentType} className="space-y-4">
              <Field label="Name" required>
                <Input name="name" required placeholder="e.g. WHMIS quiz" />
              </Field>
              <Field label="Description">
                <Textarea
                  name="description"
                  rows={3}
                  placeholder="What is this assessment for? Who should take it?"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Passing score (%)" required>
                  <Input
                    name="passingScore"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={80}
                    required
                  />
                </Field>
                <Field label="Linked course (optional)">
                  <Select name="courseId" defaultValue="__none__">
                    <option value="__none__">— No course (just a graded quiz) —</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Pre-assessment message (shown before)">
                <Textarea
                  name="preAssessmentMessage"
                  rows={2}
                  placeholder="Optional intro shown to the candidate."
                />
              </Field>
              <Field label="Post-assessment message (shown after)">
                <Textarea
                  name="postAssessmentMessage"
                  rows={2}
                  placeholder="Optional follow-up message."
                />
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="graded" defaultChecked /> Graded (computes pass/fail)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked /> Active (available to
                  assign)
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button type="submit">Create assessment type</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
