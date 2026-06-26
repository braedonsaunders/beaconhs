// New certificate — create a single training record. Person + course +
// completion date are required; expiry auto-computes from the course when left
// blank. On submit the record is created and opened, where the remaining fields
// edit inline. Replaces the old dead "Log a record" link.

import { redirect } from 'next/navigation'
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
import { people, trainingCourses } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'
import { createTrainingRecord } from '../_actions'

export const metadata = { title: 'New certificate' }
export const dynamic = 'force-dynamic'

const SOURCE_OPTIONS = [
  { value: 'external_upload', label: 'External upload' },
  { value: 'class', label: 'Class' },
  { value: 'self_paced', label: 'Self-paced' },
  { value: 'evaluator', label: 'Evaluator' },
  { value: 'migrated', label: 'Migrated' },
]

export default async function NewCertificatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const defaultPersonId = typeof sp.personId === 'string' ? sp.personId : ''
  const defaultCourseId = typeof sp.courseId === 'string' ? sp.courseId : ''

  const ctx = await requireRequestContext()
  // Recording training requires training.record.create; createTrainingRecord
  // re-checks server-side.
  if (!can(ctx, 'training.record.create')) redirect('/training/records')

  const [courses, peopleRows] = await ctx.db(async (tx) => {
    const c = await tx
      .select({
        id: trainingCourses.id,
        name: trainingCourses.name,
        code: trainingCourses.code,
      })
      .from(trainingCourses)
      .where(isNull(trainingCourses.deletedAt))
      .orderBy(asc(trainingCourses.name))
    const p = await tx
      .select()
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    return [c, p] as const
  })

  const today = new Date().toISOString().slice(0, 10)

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/training/records', label: 'Back to certificates' }}
          title="New certificate"
          subtitle="Record a completed or externally-issued training certificate. You can edit the rest of the details after it's created."
        />

        <Card>
          <CardHeader>
            <CardTitle>Certificate details</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createTrainingRecord} className="space-y-4">
              <div className="space-y-1.5">
                <Label>
                  Person <span className="text-red-600 dark:text-red-400">*</span>
                </Label>
                <PersonSelectField
                  name="personId"
                  defaultValue={defaultPersonId}
                  clearable={false}
                  placeholder="Choose a person…"
                  options={peopleRows.map((p) => ({
                    value: p.id,
                    label: `${p.lastName}, ${p.firstName}`,
                    hint: p.employeeNo ?? undefined,
                  }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="courseId">
                  Course <span className="text-red-600 dark:text-red-400">*</span>
                </Label>
                <Select id="courseId" name="courseId" required defaultValue={defaultCourseId}>
                  <option value="" disabled>
                    Choose a course…
                  </option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="completedOn">
                    Completed on <span className="text-red-600 dark:text-red-400">*</span>
                  </Label>
                  <Input
                    id="completedOn"
                    name="completedOn"
                    type="date"
                    required
                    defaultValue={today}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expiresOn">Expires on</Label>
                  <Input id="expiresOn" name="expiresOn" type="date" />
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    Leave blank to auto-compute from the course.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source">Source</Label>
                  <Select id="source" name="source" defaultValue="external_upload">
                    {SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="grade">Grade %</Label>
                  <Input id="grade" name="grade" type="number" min="0" max="100" placeholder="Optional" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="instructor">Instructor</Label>
                  <Input id="instructor" name="instructor" placeholder="Instructor or evaluator" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="details">Details</Label>
                <Textarea
                  id="details"
                  name="details"
                  rows={2}
                  placeholder="Course details, modules covered, or context"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" rows={2} placeholder="Internal notes" />
              </div>
              <div className="flex justify-end">
                <Button type="submit">Create certificate</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
