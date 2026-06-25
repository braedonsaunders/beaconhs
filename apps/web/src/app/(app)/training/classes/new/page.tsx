import { asc, eq } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { orgUnits, tenantUsers, trainingCourses, users } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { LazyRecordProvider } from '@/components/lazy-record'
import { ClassDetailFields } from '../_class-fields'
import { createClassDraft, updateClassField } from '../_actions'

export const metadata = { title: 'Schedule a class' }
export const dynamic = 'force-dynamic'

// datetime-local "YYYY-MM-DDTHH:mm" in server-local tz (round-trips with how
// updateClassField parses it back).
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default async function NewClassPage() {
  const ctx = await requireRequestContext()
  const options = await ctx.db(async (tx) => {
    const [courses, sites, instructors] = await Promise.all([
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
    return { courses, sites, instructors }
  })

  const now = new Date()
  const initial = {
    courseId: '',
    title: '',
    startsAt: toLocalInput(now),
    endsAt: toLocalInput(new Date(now.getTime() + 60 * 60_000)),
    siteOrgUnitId: null,
    instructorTenantUserId: null,
    capacity: null,
    notes: null,
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader
          title="Schedule a class"
          description="Set the course, date/time, instructor, and capacity — it saves as you go. Roster and completion open once you start. Leave without editing and nothing is created."
          back={{ href: '/training/classes', label: 'Back to classes' }}
        />
        <LazyRecordProvider createDraft={createClassDraft} recordHref="/training/classes/{id}">
          <ClassDetailFields initial={initial} options={options} updateAction={updateClassField} />
        </LazyRecordProvider>
      </div>
    </PageContainer>
  )
}
