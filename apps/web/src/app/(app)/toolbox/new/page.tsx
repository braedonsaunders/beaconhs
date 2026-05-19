import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, sql } from 'drizzle-orm'
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
import {
  orgUnits,
  people,
  tenantUsers,
  toolboxJournalAttendees,
  toolboxJournals,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { AttendeesPicker } from '../_attendees-picker'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New toolbox talk' }

async function createJournal(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) throw new Error('Title is required')
  const topic = String(formData.get('topic') ?? '').trim() || null
  const occurredOn =
    String(formData.get('occurredOn') ?? '').trim() || new Date().toISOString().slice(0, 10)
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const foremanTenantUserId =
    String(formData.get('foremanTenantUserId') ?? '').trim() || ctx.membership?.id || null
  const discussionNotes = String(formData.get('discussionNotes') ?? '').trim() || null
  const questionsRaised = String(formData.get('questionsRaised') ?? '').trim() || null
  const actionItems = String(formData.get('actionItems') ?? '').trim() || null
  const status =
    (String(formData.get('status') ?? 'draft') as 'draft' | 'submitted' | 'closed') || 'draft'
  const attendees = formData.getAll('attendeePersonIds').map((v) => String(v)).filter(Boolean)

  const created = await ctx.db(async (tx) => {
    const year = Number(occurredOn.slice(0, 4))
    const [{ c }] = await tx
      .select({ c: count() })
      .from(toolboxJournals)
      .where(sql`extract(year from ${toolboxJournals.occurredOn}) = ${year}`)
    const reference = `TBX-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`
    const [row] = await tx
      .insert(toolboxJournals)
      .values({
        tenantId: ctx.tenantId,
        reference,
        title,
        topic,
        occurredOn,
        siteOrgUnitId,
        foremanTenantUserId,
        discussionNotes,
        questionsRaised,
        actionItems,
        status,
      })
      .returning()
    if (row && attendees.length > 0) {
      await tx.insert(toolboxJournalAttendees).values(
        attendees.map((personId) => ({
          tenantId: ctx.tenantId,
          journalId: row.id,
          personId,
        })),
      )
    }
    return row
  })

  if (!created) {
    redirect('/toolbox')
  }
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: created.id,
    action: 'create',
    summary: `Logged ${created.reference}: ${title}`,
    after: {
      reference: created.reference,
      topic,
      occurredOn,
      siteOrgUnitId,
      foremanTenantUserId,
      attendees: attendees.length,
      status,
    },
  })
  revalidatePath('/toolbox')
  redirect(`/toolbox/${created.id}`)
}

export default async function NewToolboxPage() {
  const ctx = await requireRequestContext()
  const [sites, foremen, peopleRows] = await ctx.db(async (tx) => {
    const s = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const f = await tx
      .select({
        id: tenantUsers.id,
        displayName: tenantUsers.displayName,
        name: user.name,
      })
      .from(tenantUsers)
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(tenantUsers.status, 'active'))
      .orderBy(asc(user.name))
      .limit(500)
    const p = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: people.jobTitle,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(500)
    return [s, f, p] as const
  })

  const today = new Date().toISOString().slice(0, 10)
  const defaultForeman = ctx.membership?.id ?? ''

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/toolbox', label: 'Back to toolbox talks' }}
          title="New toolbox talk"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createJournal} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Title" required className="sm:col-span-2">
                  <Input name="title" required placeholder="e.g. Hot work permit refresher" />
                </Field>
                <Field label="Topic">
                  <Input name="topic" placeholder="Optional one-liner" />
                </Field>
                <Field label="Date" required>
                  <Input name="occurredOn" type="date" defaultValue={today} required />
                </Field>
                <Field label="Site">
                  <Select name="siteOrgUnitId" defaultValue="">
                    <option value="">—</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Foreman">
                  <Select name="foremanTenantUserId" defaultValue={defaultForeman}>
                    <option value="">—</option>
                    {foremen.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.displayName ?? f.name ?? f.id.slice(0, 8)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue="draft">
                    <option value="draft">Draft</option>
                    <option value="submitted">Submitted</option>
                  </Select>
                </Field>
                <Field label="Discussion notes" className="sm:col-span-2">
                  <Textarea
                    name="discussionNotes"
                    rows={5}
                    placeholder="What was covered? Key hazards, controls, talking points."
                  />
                </Field>
                <Field label="Questions raised" className="sm:col-span-2">
                  <Textarea name="questionsRaised" rows={3} placeholder="What did the crew ask?" />
                </Field>
                <Field label="Action items" className="sm:col-span-2">
                  <Textarea
                    name="actionItems"
                    rows={3}
                    placeholder="Follow-up tasks, owners, due dates"
                  />
                </Field>
                <Field label="Attendees" className="sm:col-span-2">
                  <AttendeesPicker available={peopleRows} />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create toolbox talk</Button>
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
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
