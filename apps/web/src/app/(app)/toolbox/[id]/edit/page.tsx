import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { AttendeesPicker } from '../../_attendees-picker'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Edit toolbox · ${id.slice(0, 8)}` }
}

async function updateJournal(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const title = String(formData.get('title') ?? '').trim()
  if (!title) throw new Error('Title is required')
  const topic = String(formData.get('topic') ?? '').trim() || null
  const occurredOn = String(formData.get('occurredOn') ?? '').trim() ||
    new Date().toISOString().slice(0, 10)
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const foremanTenantUserId = String(formData.get('foremanTenantUserId') ?? '').trim() || null
  const discussionNotes = String(formData.get('discussionNotes') ?? '').trim() || null
  const questionsRaised = String(formData.get('questionsRaised') ?? '').trim() || null
  const actionItems = String(formData.get('actionItems') ?? '').trim() || null
  const status =
    (String(formData.get('status') ?? 'draft') as 'draft' | 'submitted' | 'closed') || 'draft'
  const attendees = formData
    .getAll('attendeePersonIds')
    .map((v) => String(v))
    .filter(Boolean)

  await ctx.db(async (tx) => {
    await tx
      .update(toolboxJournals)
      .set({
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
      .where(eq(toolboxJournals.id, id))

    // Reconcile attendees: insert any new IDs that aren't present yet, leave
    // existing rows (and their signatures) intact. Removals happen via the
    // dedicated "remove" action on the detail page so we don't blow away
    // captured signatures here.
    if (attendees.length > 0) {
      const existing = await tx
        .select({ personId: toolboxJournalAttendees.personId })
        .from(toolboxJournalAttendees)
        .where(eq(toolboxJournalAttendees.journalId, id))
      const have = new Set(existing.map((r) => r.personId))
      const toInsert = attendees.filter((pid) => !have.has(pid))
      if (toInsert.length > 0) {
        await tx.insert(toolboxJournalAttendees).values(
          toInsert.map((personId) => ({
            tenantId: ctx.tenantId,
            journalId: id,
            personId,
          })),
        )
      }
    }
  })

  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: id,
    action: 'update',
    summary: 'Edited toolbox talk',
    after: {
      title,
      topic,
      occurredOn,
      siteOrgUnitId,
      foremanTenantUserId,
      status,
      addedAttendees: attendees.length,
    },
  })
  revalidatePath(`/toolbox/${id}`)
  revalidatePath('/toolbox')
  redirect(`/toolbox/${id}`)
}

export default async function EditToolboxPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [j] = await tx
      .select()
      .from(toolboxJournals)
      .where(eq(toolboxJournals.id, id))
      .limit(1)
    if (!j) return null
    const sites = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const foremen = await tx
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
    const allPeople = await tx
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
    const att = await tx
      .select({ personId: toolboxJournalAttendees.personId })
      .from(toolboxJournalAttendees)
      .where(eq(toolboxJournalAttendees.journalId, id))
    return { j, sites, foremen, allPeople, attendeeIds: att.map((a) => a.personId) }
  })
  if (!data) notFound()
  const { j, sites, foremen, allPeople, attendeeIds } = data

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: `/toolbox/${id}`, label: 'Back to toolbox talk' }}
          title={`Edit ${j.reference}`}
        />
        {j.locked ? (
          <Alert variant="warning">
            <AlertTitle>This toolbox talk is locked</AlertTitle>
            <AlertDescription>
              Unlock it from the detail page header before editing.
            </AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardContent className="pt-6">
            <form action={updateJournal} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <fieldset
                disabled={j.locked}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 disabled:opacity-60"
              >
                <Field label="Title" required className="sm:col-span-2">
                  <Input name="title" required defaultValue={j.title} />
                </Field>
                <Field label="Topic">
                  <Input name="topic" defaultValue={j.topic ?? ''} />
                </Field>
                <Field label="Date" required>
                  <Input name="occurredOn" type="date" defaultValue={j.occurredOn} required />
                </Field>
                <Field label="Site">
                  <Select name="siteOrgUnitId" defaultValue={j.siteOrgUnitId ?? ''}>
                    <option value="">—</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Foreman">
                  <Select
                    name="foremanTenantUserId"
                    defaultValue={j.foremanTenantUserId ?? ''}
                  >
                    <option value="">—</option>
                    {foremen.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.displayName ?? f.name ?? f.id.slice(0, 8)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={j.status}>
                    <option value="draft">Draft</option>
                    <option value="submitted">Submitted</option>
                    <option value="closed">Closed</option>
                  </Select>
                </Field>
                <Field label="Discussion notes" className="sm:col-span-2">
                  <Textarea
                    name="discussionNotes"
                    rows={5}
                    defaultValue={j.discussionNotes ?? ''}
                  />
                </Field>
                <Field label="Questions raised" className="sm:col-span-2">
                  <Textarea
                    name="questionsRaised"
                    rows={3}
                    defaultValue={j.questionsRaised ?? ''}
                  />
                </Field>
                <Field label="Action items" className="sm:col-span-2">
                  <Textarea
                    name="actionItems"
                    rows={3}
                    defaultValue={j.actionItems ?? ''}
                  />
                </Field>
                <Field label="Attendees" className="sm:col-span-2">
                  <p className="text-xs text-slate-500">
                    Removing attendees here doesn't delete existing signatures — use the
                    attendees tab to remove a signed attendee.
                  </p>
                  <AttendeesPicker
                    available={allPeople}
                    defaultSelectedIds={attendeeIds}
                  />
                </Field>
              </fieldset>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={j.locked}>
                  Save changes
                </Button>
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
