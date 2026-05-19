import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, notInArray } from 'drizzle-orm'
import {
  AlertCircle,
  FileText,
  Lock,
  Mail,
  Pencil,
  Plus,
  Send,
  Trash2,
  Unlock,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Label,
  Select,
  UrlDrawer,
} from '@beaconhs/ui'
import { pickString } from '@/lib/list-params'
import {
  attachments,
  orgUnits,
  people,
  tenantUsers,
  toolboxJournalAttendees,
  toolboxJournalPhotos,
  toolboxJournals,
  user,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { ActivityFeed } from '@/components/activity-feed'
import { PhotoGallery } from '@/components/photo-gallery'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { DetailPageLayout } from '@/components/page-layout'
import { ToolboxStatusBadge } from '../_status-badge'
import { sendJournalEmail } from './_send-email'
import { SignAttendeeBody } from './_sign-attendee-body'

export const dynamic = 'force-dynamic'

const STATUSES = ['draft', 'submitted', 'closed'] as const
const TABS = ['overview', 'attendees', 'photos', 'activity'] as const
type Tab = (typeof TABS)[number]

// ---------- Server actions ----------

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as (typeof STATUSES)[number]
  if (!STATUSES.includes(status)) return
  const closing = status === 'closed'
  await ctx.db((tx) =>
    tx
      .update(toolboxJournals)
      .set({
        status,
        locked: closing,
        lockedAt: closing ? new Date() : null,
      })
      .where(eq(toolboxJournals.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: id,
    action: 'update',
    summary: `Status moved to "${status}"`,
    after: { status, locked: closing },
  })
  revalidatePath(`/toolbox/${id}`)
  revalidatePath('/toolbox')
}

async function toggleLock(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const lock = formData.get('lock') === 'true'
  await ctx.db((tx) =>
    tx
      .update(toolboxJournals)
      .set({ locked: lock, lockedAt: lock ? new Date() : null })
      .where(eq(toolboxJournals.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: id,
    action: 'update',
    summary: lock ? 'Locked' : 'Unlocked',
    after: { locked: lock },
  })
  revalidatePath(`/toolbox/${id}`)
}

async function deleteJournal(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(toolboxJournals).where(eq(toolboxJournals.id, id)))
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: id,
    action: 'delete',
    summary: 'Deleted toolbox talk',
  })
  revalidatePath('/toolbox')
  redirect('/toolbox')
}

async function addAttendee(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const journalId = String(formData.get('journalId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!journalId || !personId) return
  await ctx.db(async (tx) => {
    const existing = await tx
      .select({ id: toolboxJournalAttendees.id })
      .from(toolboxJournalAttendees)
      .where(
        and(
          eq(toolboxJournalAttendees.journalId, journalId),
          eq(toolboxJournalAttendees.personId, personId),
        ),
      )
      .limit(1)
    if (existing.length > 0) return
    await tx.insert(toolboxJournalAttendees).values({
      tenantId: ctx.tenantId,
      journalId,
      personId,
    })
  })
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: journalId,
    action: 'update',
    summary: 'Added attendee',
    after: { personId },
  })
  revalidatePath(`/toolbox/${journalId}`)
  redirect(`/toolbox/${journalId}?tab=attendees`)
}

async function removeAttendee(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const journalId = String(formData.get('journalId') ?? '')
  const attendeeId = String(formData.get('attendeeId') ?? '')
  if (!journalId || !attendeeId) return
  await ctx.db((tx) =>
    tx.delete(toolboxJournalAttendees).where(eq(toolboxJournalAttendees.id, attendeeId)),
  )
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: journalId,
    action: 'update',
    summary: 'Removed attendee',
    after: { attendeeId },
  })
  revalidatePath(`/toolbox/${journalId}`)
}

async function saveSignature(attendeeId: string, dataUrl: string | null) {
  'use server'
  const ctx = await requireRequestContext()
  const journalId = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ id: toolboxJournalAttendees.id, journalId: toolboxJournalAttendees.journalId })
      .from(toolboxJournalAttendees)
      .where(eq(toolboxJournalAttendees.id, attendeeId))
      .limit(1)
    if (!row) return null
    await tx
      .update(toolboxJournalAttendees)
      .set({
        signatureDataUrl: dataUrl,
        signedAt: dataUrl ? new Date() : null,
      })
      .where(eq(toolboxJournalAttendees.id, attendeeId))
    return row.journalId
  })
  if (!journalId) return
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: journalId,
    action: dataUrl ? 'sign' : 'update',
    summary: dataUrl ? 'Attendee signed' : 'Cleared attendee signature',
    after: { attendeeId, signed: !!dataUrl },
  })
  revalidatePath(`/toolbox/${journalId}`)
}

async function attachPhotos(journalId: string, attachmentIds: string[]) {
  'use server'
  const ctx = await requireRequestContext()
  if (attachmentIds.length === 0) return
  await ctx.db((tx) =>
    tx.insert(toolboxJournalPhotos).values(
      attachmentIds.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        journalId,
        attachmentId,
      })),
    ),
  )
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: journalId,
    action: 'update',
    summary: `Attached ${attachmentIds.length} photo${attachmentIds.length === 1 ? '' : 's'}`,
  })
  revalidatePath(`/toolbox/${journalId}`)
}

async function sendEmail(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await sendJournalEmail(ctx, id)
  revalidatePath(`/toolbox/${id}`)
  redirect(`/toolbox/${id}`)
}

// ---------- Page ----------

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Toolbox · ${id.slice(0, 8)}` }
}

export default async function ToolboxDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')
  const drawer = pickString(sp.drawer)
  const drawerAttendeeId = pickString(sp.attendeeId)
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        j: toolboxJournals,
        site: orgUnits,
        foremanMembership: tenantUsers,
        foremanUser: user,
      })
      .from(toolboxJournals)
      .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, toolboxJournals.foremanTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(toolboxJournals.id, id))
      .limit(1)
    if (!row) return null

    const attendeeRows = await tx
      .select({ att: toolboxJournalAttendees, person: people })
      .from(toolboxJournalAttendees)
      .innerJoin(people, eq(people.id, toolboxJournalAttendees.personId))
      .where(eq(toolboxJournalAttendees.journalId, id))
      .orderBy(asc(people.lastName), asc(people.firstName))

    const memberIds = attendeeRows.map((a) => a.person.id)
    const availablePeople =
      memberIds.length > 0
        ? await tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              jobTitle: people.jobTitle,
            })
            .from(people)
            .where(and(eq(people.status, 'active'), notInArray(people.id, memberIds)))
            .orderBy(asc(people.lastName), asc(people.firstName))
            .limit(500)
        : await tx
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

    const photoRows = await tx
      .select({
        link: toolboxJournalPhotos,
        attachment: attachments,
      })
      .from(toolboxJournalPhotos)
      .innerJoin(attachments, eq(attachments.id, toolboxJournalPhotos.attachmentId))
      .where(eq(toolboxJournalPhotos.journalId, id))

    return { ...row, attendeeRows, availablePeople, photoRows }
  })
  if (!data) notFound()

  const { j, site, foremanMembership, foremanUser, attendeeRows, availablePeople, photoRows } =
    data
  const activity = await recentActivityForEntity(ctx, 'toolbox_journal', id, 25)
  const galleryPhotos = photoRows.map((p) => ({
    id: p.link.id,
    url: publicUrl(p.attachment.r2Key),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))
  const signedCount = attendeeRows.filter((a) => !!a.att.signatureDataUrl).length

  const basePath = `/toolbox/${id}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/toolbox', label: 'Back to toolbox talks' }}
          title={j.title}
          subtitle={`${j.reference} · ${j.occurredOn}`}
          badge={
            <div className="flex items-center gap-2">
              <ToolboxStatusBadge status={j.status} />
              {j.locked ? (
                <Badge variant="outline" className="border-amber-300 text-amber-800">
                  <Lock size={10} /> Locked
                </Badge>
              ) : null}
            </div>
          }
          actions={
            <>
              <Link href={`/toolbox/${id}/edit`}>
                <Button variant="outline" disabled={j.locked}>
                  <Pencil size={14} /> Edit
                </Button>
              </Link>
              <Link href={`/toolbox/${id}/pdf`} target="_blank">
                <Button variant="outline">
                  <FileText size={14} /> PDF
                </Button>
              </Link>
              <Link href={`/toolbox/${id}?drawer=send-email`}>
                <Button type="button" variant="outline">
                  <Mail size={14} /> Send email
                </Button>
              </Link>
              <form action={toggleLock} className="inline">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="lock" value={j.locked ? 'false' : 'true'} />
                <Button type="submit" variant="outline">
                  {j.locked ? (
                    <>
                      <Unlock size={14} /> Unlock
                    </>
                  ) : (
                    <>
                      <Lock size={14} /> Lock
                    </>
                  )}
                </Button>
              </form>
              <form action={deleteJournal} className="inline">
                <input type="hidden" name="id" value={id} />
                <Button
                  type="submit"
                  variant="outline"
                  className="text-red-700 hover:text-red-900"
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </form>
            </>
          }
        />
      }
      alerts={
        j.locked ? (
          <Alert variant="warning">
            <AlertTitle>This toolbox talk is locked</AlertTitle>
            <AlertDescription>
              Locked on {j.lockedAt ? new Date(j.lockedAt).toLocaleString() : '—'}. Unlock to make
              edits.
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'attendees', label: 'Attendees', count: attendeeRows.length },
            { key: 'photos', label: 'Photos', count: photoRows.length },
            { key: 'activity', label: 'Activity', count: activity.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <Section title="General">
              <DetailGrid
                rows={[
                  {
                    label: 'Reference',
                    value: <span className="font-mono">{j.reference}</span>,
                  },
                  { label: 'Date', value: j.occurredOn },
                  { label: 'Topic', value: j.topic ?? '—' },
                  { label: 'Site', value: site?.name ?? '—' },
                  {
                    label: 'Foreman',
                    value:
                      foremanUser?.name ?? foremanMembership?.displayName ?? '—',
                  },
                  { label: 'Status', value: j.status },
                  {
                    label: 'Attendees',
                    value: `${attendeeRows.length} (${signedCount} signed)`,
                  },
                  {
                    label: 'Created',
                    value: new Date(j.createdAt).toLocaleString(),
                  },
                ]}
              />
            </Section>

            <Section title="Discussion">
              {j.discussionNotes ? (
                <p className="whitespace-pre-wrap text-sm text-slate-700">{j.discussionNotes}</p>
              ) : (
                <p className="text-sm text-slate-500">No discussion notes recorded.</p>
              )}
            </Section>

            <Section title="Questions raised">
              {j.questionsRaised ? (
                <p className="whitespace-pre-wrap text-sm text-slate-700">{j.questionsRaised}</p>
              ) : (
                <p className="text-sm text-slate-500">None recorded.</p>
              )}
            </Section>

            <Section title="Action items">
              {j.actionItems ? (
                <p className="whitespace-pre-wrap text-sm text-slate-700">{j.actionItems}</p>
              ) : (
                <p className="text-sm text-slate-500">None recorded.</p>
              )}
            </Section>

            <Card>
              <CardHeader>
                <CardTitle>Status workflow</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={updateStatus} className="flex items-end gap-3">
                  <input type="hidden" name="id" value={id} />
                  <div className="space-y-1.5">
                    <Label>Move to</Label>
                    <Select name="status" defaultValue={j.status}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="submit" disabled={j.locked}>
                    Update
                  </Button>
                </form>
                <p className="mt-2 text-xs text-slate-500">
                  Closing a toolbox talk locks it. Unlock from the header to re-open.
                </p>
              </CardContent>
            </Card>
          </>
        ) : null}

        {active === 'attendees' ? (
          <>
            <Section title={`Attendees (${attendeeRows.length} · ${signedCount} signed)`}>
              {attendeeRows.length === 0 ? (
                <EmptyState
                  icon={<AlertCircle size={24} />}
                  title="No attendees yet"
                  description="Use the form below to add attendees, then capture each person's signature."
                />
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {attendeeRows.map((row) => {
                    const alreadySigned = !!row.att.signatureDataUrl
                    return (
                      <li key={row.att.id} className="space-y-2 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              href={`/toolbox/transcripts/${row.person.id}`}
                              className="font-medium hover:underline"
                            >
                              {row.person.lastName}, {row.person.firstName}
                            </Link>
                            {row.person.jobTitle ? (
                              <span className="ml-2 text-xs text-slate-500">
                                {row.person.jobTitle}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            {alreadySigned ? (
                              <Badge variant="success">
                                Signed {row.att.signedAt
                                  ? new Date(row.att.signedAt).toLocaleDateString()
                                  : ''}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Not signed</Badge>
                            )}
                            {!j.locked ? (
                              <>
                                <Link
                                  href={`/toolbox/${id}?tab=attendees&drawer=sign-attendee&attendeeId=${row.att.id}`}
                                >
                                  <Button type="button" variant="ghost" size="sm">
                                    <Pencil size={12} />
                                    {alreadySigned ? 'Re-sign' : 'Sign'}
                                  </Button>
                                </Link>
                                <form action={removeAttendee} className="inline">
                                  <input type="hidden" name="journalId" value={id} />
                                  <input type="hidden" name="attendeeId" value={row.att.id} />
                                  <Button
                                    type="submit"
                                    variant="ghost"
                                    size="sm"
                                    aria-label="Remove attendee"
                                  >
                                    <Trash2 size={14} className="text-red-500" />
                                  </Button>
                                </form>
                              </>
                            ) : null}
                          </div>
                        </div>
                        {alreadySigned ? (
                          <div className="ml-1">
                            <img
                              src={row.att.signatureDataUrl ?? ''}
                              alt="Signature"
                              className="h-16 rounded border border-slate-200 bg-white p-1"
                            />
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Section>

            {!j.locked ? (
              availablePeople.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Every active person is already on this attendee list.
                </p>
              ) : (
                <Link href={`/toolbox/${id}?tab=attendees&drawer=add-attendee`}>
                  <Button>
                    <Plus size={14} /> Add attendee
                  </Button>
                </Link>
              )
            ) : null}
          </>
        ) : null}

        {active === 'photos' ? (
          <Section title={`Photos (${photoRows.length})`}>
            <div className="space-y-3">
              <PhotoGallery photos={galleryPhotos} />
              {!j.locked ? (
                <PhotoUploaderSection
                  attachAction={async (ids) => {
                    'use server'
                    await attachPhotos(id, ids)
                  }}
                />
              ) : null}
            </div>
          </Section>
        ) : null}

        {active === 'activity' ? (
          <Section title={`Activity (${activity.length})`}>
            <ActivityFeed entries={activity} />
          </Section>
        ) : null}
      </div>

      <UrlDrawer
        open={drawer === 'add-attendee'}
        closeHref={`/toolbox/${id}?tab=attendees`}
        title="Add attendee"
        description="Pick an active person from the directory to add to this toolbox talk."
        size="md"
        footer={
          <>
            <Link href={`/toolbox/${id}?tab=attendees`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="tb-add-attendee-form">
              <Plus size={14} /> Add attendee
            </Button>
          </>
        }
      >
        <form id="tb-add-attendee-form" action={addAttendee} className="space-y-3">
          <input type="hidden" name="journalId" value={id} />
          <div className="space-y-1.5">
            <Label>Person</Label>
            <Select name="personId" required defaultValue="">
              <option value="">Select a person…</option>
              {availablePeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.lastName}, {p.firstName}
                  {p.jobTitle ? ` — ${p.jobTitle}` : ''}
                </option>
              ))}
            </Select>
          </div>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'sign-attendee' && Boolean(drawerAttendeeId)}
        closeHref={`/toolbox/${id}?tab=attendees`}
        title="Sign here"
        description="Capture the attendee's signature."
        size="md"
        footer={
          <>
            <Link href={`/toolbox/${id}?tab=attendees`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="tb-sign-attendee-form">
              Save signature
            </Button>
          </>
        }
      >
        {drawerAttendeeId ? (
          <SignAttendeeBody
            attendeeId={drawerAttendeeId}
            formId="tb-sign-attendee-form"
            closeHref={`/toolbox/${id}?tab=attendees`}
            saveAction={saveSignature}
          />
        ) : null}
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'send-email'}
        closeHref={`/toolbox/${id}`}
        title={`Send toolbox talk · ${j.reference}`}
        description="Sends a structured recap to every active tenant admin."
        size="md"
        footer={
          <>
            <Link href={`/toolbox/${id}`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="tb-send-email-form">
              <Send size={14} /> Send
            </Button>
          </>
        }
      >
        <form id="tb-send-email-form" action={sendEmail} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-slate-600">
            Sends an HTML email summarising attendees, discussion, questions raised, and
            action items. Delivery happens via the configured email provider.
          </p>
          <ul className="rounded-md border border-slate-200 bg-slate-50/40 p-3 text-xs text-slate-600">
            <li>Reference: <span className="font-mono">{j.reference}</span></li>
            <li>Date: {j.occurredOn}</li>
            <li>Attendees: {attendeeRows.length} ({signedCount} signed)</li>
          </ul>
        </form>
      </UrlDrawer>
    </DetailPageLayout>
  )
}
