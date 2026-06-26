import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
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
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New training course' }

const DELIVERY_OPTIONS = [
  { value: 'classroom', label: 'Classroom' },
  { value: 'self_paced', label: 'Self-paced' },
  { value: 'online', label: 'Online' },
  { value: 'on_the_job', label: 'On-the-job' },
  { value: 'external_certificate', label: 'External certificate' },
] as const

async function createCourse(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId
  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim()
  if (!name || !code) throw new Error('Name and code are required')
  const deliveryType = String(formData.get('deliveryType') ?? 'classroom').trim() as
    | 'classroom'
    | 'self_paced'
    | 'on_the_job'
    | 'external_certificate'
    | 'online'
  const description = String(formData.get('description') ?? '').trim() || null
  const durationRaw = String(formData.get('durationMinutes') ?? '').trim()
  const durationMinutes = durationRaw ? Number(durationRaw) : null
  const validRaw = String(formData.get('validForMonths') ?? '').trim()
  const validForMonths = validRaw ? Number(validRaw) : null
  const requiresEvaluator = formData.get('requiresEvaluator') === 'on'

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(trainingCourses)
      .values({
        tenantId,
        name,
        code,
        description,
        deliveryType,
        durationMinutes: Number.isFinite(durationMinutes!) ? (durationMinutes as number) : null,
        validForMonths: Number.isFinite(validForMonths!) ? (validForMonths as number) : null,
        requiresEvaluator,
      } as any)
      .returning()
    return r
  })
  if (row) {
    await recordAudit(ctx, {
      entityType: 'training_course',
      entityId: row.id,
      action: 'create',
      summary: `Created course "${name}" (${code})`,
      after: { name, code, deliveryType, durationMinutes, validForMonths, requiresEvaluator },
    })
  }
  revalidatePath('/training/courses')
  if (row) redirect(`/training/courses/${row.id}`)
  redirect('/training/courses')
}

export default async function NewTrainingCoursePage() {
  await requireRequestContext()
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/training/courses', label: 'Back to courses' }}
          title="New training course"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createCourse} className="space-y-4">
              <Field label="Name" required>
                <Input name="name" required placeholder="e.g. Working at Heights" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code" required>
                  <Input name="code" required placeholder="e.g. WAH-2024" />
                </Field>
                <Field label="Delivery type" required>
                  <Select name="deliveryType" defaultValue="classroom">
                    {DELIVERY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Description">
                <Textarea name="description" rows={3} placeholder="What does this course cover?" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Duration (minutes)">
                  <Input name="durationMinutes" type="number" min={1} placeholder="e.g. 240" />
                </Field>
                <Field label="Valid for (months)">
                  <Input
                    name="validForMonths"
                    type="number"
                    min={1}
                    placeholder="Leave blank if no expiry"
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="requiresEvaluator" /> Requires evaluator sign-off
              </label>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create course</Button>
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
