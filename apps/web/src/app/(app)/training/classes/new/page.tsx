import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { asc, eq } from 'drizzle-orm'
import { Button, Input, Label, PageHeader, Select, Textarea } from '@beaconhs/ui'
import { orgUnits, tenantUsers, trainingClasses, trainingCourses, users } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'

export const metadata = { title: 'Schedule training class' }
export const dynamic = 'force-dynamic'

// Complex record → full-page create that captures the essentials, then drops the
// coordinator on the unified class record where every field auto-saves and the
// roster/completion live (mirrors the incident "report → detail page" flow).
async function createClass(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const courseId = String(formData.get('courseId') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const startsAtRaw = String(formData.get('startsAt') ?? '').trim()
  const durationMinutesRaw = String(formData.get('durationMinutes') ?? '').trim()
  const instructorTenantUserId = String(formData.get('instructorTenantUserId') ?? '').trim() || null
  const capacityRaw = String(formData.get('capacity') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!courseId || !title || !startsAtRaw) return

  const durationMinutes = durationMinutesRaw ? Number(durationMinutesRaw) : 60
  const capacity = capacityRaw ? Number(capacityRaw) : null
  const startsAt = new Date(startsAtRaw)
  if (Number.isNaN(startsAt.getTime())) return
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000)

  const classId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingClasses)
      .values({
        tenantId: ctx.tenantId,
        courseId,
        title,
        siteOrgUnitId,
        startsAt,
        endsAt,
        instructorTenantUserId,
        capacity,
        notes,
      })
      .returning({ id: trainingClasses.id })
    if (!row) throw new Error('Failed to insert class')
    return row.id
  })

  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: classId,
    action: 'create',
    summary: `Scheduled training class "${title}"`,
    after: { courseId, title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
  })
  revalidatePath('/training/classes')
  redirect(`/training/classes/${classId}`)
}

export default async function NewClassPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const presetCourseId = pickString(sp.courseId) ?? ''
  const ctx = await requireRequestContext()
  const { courses, sites, instructors } = await ctx.db(async (tx) => {
    const [c, s, i] = await Promise.all([
      tx
        .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
        .from(trainingCourses)
        .orderBy(asc(trainingCourses.name)),
      tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.level, 'site'))
        .orderBy(asc(orgUnits.name)),
      tx
        .select({
          id: tenantUsers.id,
          name: users.name,
          displayName: tenantUsers.displayName,
          email: users.email,
        })
        .from(tenantUsers)
        .leftJoin(users, eq(users.id, tenantUsers.userId))
        .where(eq(tenantUsers.status, 'active')),
    ])
    return { courses: c, sites: s, instructors: i }
  })

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Schedule a training class"
          description="Set the course, date/time, instructor, and capacity. Attendees can be rostered and completion marked on the class record."
          back={{ href: '/training/classes', label: 'Back to classes' }}
        />
        <form
          action={createClass}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
        >
          <Field label="Course" required>
            <Select name="courseId" defaultValue={presetCourseId} required>
              <option value="" disabled>
                Pick a course…
              </option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" required>
            <Input name="title" required placeholder="e.g. Fall Protection — Mar 12 morning" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Starts at" required>
              <Input name="startsAt" type="datetime-local" required />
            </Field>
            <Field label="Duration (minutes)">
              <Input name="durationMinutes" type="number" min="15" defaultValue="60" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Site (location)">
              <Select name="siteOrgUnitId" defaultValue="">
                <option value="">— Pick a site —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Instructor">
              <PersonSelectField
                name="instructorTenantUserId"
                options={instructors.map((i) => ({
                  value: i.id,
                  label: i.displayName ?? i.name ?? '(no name)',
                  hint: i.email ?? undefined,
                }))}
                placeholder="Pick an instructor..."
                searchPlaceholder="Search instructors..."
                sheetTitle="Select an instructor"
                emptyLabel="No instructor"
              />
            </Field>
          </div>
          <Field label="Max attendees">
            <Input name="capacity" type="number" min="1" placeholder="e.g. 12" />
          </Field>
          <Field label="Notes">
            <Textarea name="notes" rows={3} placeholder="Location details, prereqs, etc." />
          </Field>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Link href="/training/classes">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Schedule class</Button>
          </div>
        </form>
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
