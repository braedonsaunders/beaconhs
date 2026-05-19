import { asc, eq, isNull } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  people,
  roles,
  trades,
  trainingAssessmentTypes,
  trainingCourses,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createAudienceAssignment } from '../../_actions/assignments'

export const metadata = { title: 'New training assignment' }
export const dynamic = 'force-dynamic'

export default async function NewAssignmentPage() {
  const ctx = await requireRequestContext()
  const [coursesRows, typesRows, peopleRows, tradesRows, rolesRows] = await ctx.db(async (tx) => {
    const cs = await tx
      .select()
      .from(trainingCourses)
      .orderBy(asc(trainingCourses.name))
    const ts = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(isNull(trainingAssessmentTypes.deletedAt))
      .orderBy(asc(trainingAssessmentTypes.name))
    const ps = await tx
      .select()
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const trs = await tx.select().from(trades).orderBy(asc(trades.name))
    const rs = await tx.select().from(roles).orderBy(asc(roles.name))
    return [cs, ts, ps, trs, rs] as const
  })

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/training/assignments', label: 'Back to assignments' }}
          title="New training assignment"
          subtitle="Pick the audience (any combination of people, trades, roles, or everyone), pick the course or assessment, and set a due date."
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createAudienceAssignment} className="space-y-5">
              <Field label="Name" required>
                <Input
                  name="name"
                  required
                  placeholder='e.g. "Q4 WHMIS refresher for all field staff"'
                />
              </Field>
              <Field label="Notes">
                <Textarea name="notes" rows={2} />
              </Field>

              <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-xs uppercase tracking-wide text-slate-500">
                  What to assign
                </legend>
                <Field label="Item type" required>
                  <Select name="itemKind" defaultValue="course">
                    <option value="course">Course (training_records)</option>
                    <option value="assessment_type">Assessment (graded quiz)</option>
                  </Select>
                </Field>
                <Field label="Course">
                  <Select name="courseId" defaultValue="">
                    <option value="">— Pick a course (if assigning a course) —</option>
                    {coursesRows.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Assessment type">
                  <Select name="assessmentTypeId" defaultValue="">
                    <option value="">— Pick an assessment (if assigning a quiz) —</option>
                    {typesRows.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </fieldset>

              <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-xs uppercase tracking-wide text-slate-500">
                  Audience
                </legend>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="everyone" />
                  Everyone (overrides specific picks below)
                </label>
                <Field label="People (Cmd/Ctrl-click for multiple)">
                  <select
                    name="personId"
                    multiple
                    className="w-full rounded-md border border-slate-200 p-2 text-sm"
                    size={Math.min(8, Math.max(4, peopleRows.length))}
                  >
                    {peopleRows.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lastName}, {p.firstName}
                        {p.employeeNo ? ` (#${p.employeeNo})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Trades">
                  <select
                    name="tradeId"
                    multiple
                    className="w-full rounded-md border border-slate-200 p-2 text-sm"
                    size={Math.min(5, Math.max(3, tradesRows.length))}
                  >
                    {tradesRows.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Roles">
                  <select
                    name="roleKey"
                    multiple
                    className="w-full rounded-md border border-slate-200 p-2 text-sm"
                    size={Math.min(5, Math.max(3, rolesRows.length))}
                  >
                    {rolesRows.map((r) => (
                      <option key={r.id} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </fieldset>

              <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-xs uppercase tracking-wide text-slate-500">
                  When
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Due date">
                    <Input name="dueOn" type="date" />
                  </Field>
                  <Field label="Remind before (days)">
                    <Input name="remindBeforeDays" type="number" min={0} defaultValue={7} />
                  </Field>
                </div>
                <Field label="Recurrence cron (optional)">
                  <Input
                    name="recurrenceCron"
                    placeholder='e.g. "0 0 1 1 *" for yearly on Jan 1'
                  />
                </Field>
                <p className="text-xs text-slate-500">
                  Cron expression syntax. Leave blank for one-off assignments. The worker
                  re-creates a fresh assignment each tick.
                </p>
              </fieldset>

              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create assignment</Button>
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
