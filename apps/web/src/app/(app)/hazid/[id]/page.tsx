import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  UrlDrawer,
} from '@beaconhs/ui'
import { Copy, FileText, Lock, Mail, Plus, Unlock } from 'lucide-react'
import {
  atmosphericSensors,
  attachments,
  hazidAssessmentCSAtmospheric,
  hazidAssessmentCSEntries,
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentPhotos,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidHazardSets,
  hazidHazardTypes,
  hazidHazards,
  hazidTasks,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { sendHazidEmail } from './_send-email'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { PhotoGallery } from '@/components/photo-gallery'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  addCSAtmospheric,
  addCSEntry,
  addHazard,
  addHazardSet,
  addPPE,
  addQuestion,
  addSignature,
  addTask,
  answerPPE,
  answerQuestion,
  attachPhotos,
  copyAssessment,
  deleteCSAtmospheric,
  deleteCSEntry,
  deleteHazard,
  deletePPE,
  deletePhoto,
  deleteQuestion,
  deleteSignature,
  deleteTask,
  exitCSEntry,
  lockAssessment,
  moveHazard,
  movePPE,
  moveQuestion,
  moveTask,
  unlockAssessment,
  updateHazard,
  updatePPE,
  updateQuestion,
  updateTask,
  updateTextField,
} from '../_actions'
import {
  AddAtmosphericDrawerBody,
  AddEntryDrawerBody,
  AddHazardDrawerBody,
  AddHazardLibraryDrawerBody,
  AddHazardSetDrawerBody,
  AddPPEDrawerBody,
  AddQuestionDrawerBody,
  AddTaskDrawerBody,
  EditHazardDrawerBody,
  EditPPEDrawerBody,
  EditQuestionDrawerBody,
  EditTaskDrawerBody,
  ExitEntryDrawerBody,
  HazardRow,
  PPERow,
  QuestionRow,
  SubFormToggle,
  TaskRow,
} from './_sections'
import { InlineField } from '../_field'
import { CSDiagram } from '../_cs-diagram'
import { AddSignatureDrawerBody } from '../_signature-form'
import { HazidPhotoUploader } from '../_photo-uploader'

export const dynamic = 'force-dynamic'

// Inline server action for the Send-email modal. Reads recipient list,
// optional Cc, subject prefix, and message override from the form data,
// then delegates to `sendHazidEmail` which composes the message + writes
// an audit row.
async function sendEmailAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const subjectPrefix = String(formData.get('subjectPrefix') ?? '').trim() || undefined
  const messageOverride = String(formData.get('message') ?? '').trim() || undefined
  const splitEmails = (raw: string) =>
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
  const recipients = splitEmails(String(formData.get('recipients') ?? ''))
  const cc = splitEmails(String(formData.get('cc') ?? ''))
  await sendHazidEmail(ctx, id, {
    recipients: recipients.length > 0 ? recipients : undefined,
    cc: cc.length > 0 ? cc : undefined,
    subjectPrefix,
    messageOverride,
  })
  revalidatePath(`/hazid/${id}`)
}

const TABS = [
  'overview',
  'ppe',
  'questions',
  'tasks',
  'hazards',
  'wah',
  'cs',
  'arc',
  'signatures',
  'photos',
  'activity',
] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `HazID · ${id.slice(0, 8)}` }
}

export default async function HazidAssessmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active = pickActiveTab(sp, TABS, 'overview')
  const ctx = await requireRequestContext()
  const drawerKey = pickString(sp.drawer) ?? ''
  const editTaskId = pickString(sp.taskId) ?? ''
  const editHazardId = pickString(sp.hazardId) ?? ''
  const editPPEId = pickString(sp.ppeId) ?? ''
  const editQuestionId = pickString(sp.questionId) ?? ''
  const editEntryId = pickString(sp.entryId) ?? ''

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        a: hazidAssessments,
        site: orgUnits,
        type: hazidAssessmentTypes,
        supervisor: people,
      })
      .from(hazidAssessments)
      .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
      .leftJoin(
        hazidAssessmentTypes,
        eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
      )
      .leftJoin(people, eq(people.id, hazidAssessments.supervisorPersonId))
      .where(and(eq(hazidAssessments.id, id), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!row) return null

    let project: { id: string; name: string } | null = null
    if (row.a.projectOrgUnitId) {
      const [p] = await tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.id, row.a.projectOrgUnitId))
        .limit(1)
      project = p ?? null
    }

    const tasks = await tx
      .select({ row: hazidAssessmentTasks, task: hazidTasks })
      .from(hazidAssessmentTasks)
      .leftJoin(hazidTasks, eq(hazidTasks.id, hazidAssessmentTasks.taskId))
      .where(eq(hazidAssessmentTasks.assessmentId, id))
      .orderBy(asc(hazidAssessmentTasks.entityOrder))
    const hazards = await tx
      .select({ row: hazidAssessmentHazards, library: hazidHazards })
      .from(hazidAssessmentHazards)
      .leftJoin(hazidHazards, eq(hazidHazards.id, hazidAssessmentHazards.hazardId))
      .where(eq(hazidAssessmentHazards.assessmentId, id))
      .orderBy(asc(hazidAssessmentHazards.entityOrder))
    const ppe = await tx
      .select()
      .from(hazidAssessmentPPE)
      .where(eq(hazidAssessmentPPE.assessmentId, id))
      .orderBy(asc(hazidAssessmentPPE.entityOrder))
    const questions = await tx
      .select()
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, id))
      .orderBy(asc(hazidAssessmentQuestions.entityOrder))
    const signatures = await tx
      .select({ row: hazidAssessmentSignatures, person: people })
      .from(hazidAssessmentSignatures)
      .leftJoin(people, eq(people.id, hazidAssessmentSignatures.personId))
      .where(eq(hazidAssessmentSignatures.assessmentId, id))
      .orderBy(asc(hazidAssessmentSignatures.createdAt))
    const photos = await tx
      .select({ link: hazidAssessmentPhotos, attachment: attachments })
      .from(hazidAssessmentPhotos)
      .innerJoin(attachments, eq(attachments.id, hazidAssessmentPhotos.attachmentId))
      .where(eq(hazidAssessmentPhotos.assessmentId, id))
    const atmospheric = await tx
      .select({ row: hazidAssessmentCSAtmospheric, sensor: atmosphericSensors })
      .from(hazidAssessmentCSAtmospheric)
      .leftJoin(
        atmosphericSensors,
        eq(atmosphericSensors.id, hazidAssessmentCSAtmospheric.atmosphericSensorId),
      )
      .where(eq(hazidAssessmentCSAtmospheric.assessmentId, id))
      .orderBy(asc(hazidAssessmentCSAtmospheric.time))
    const entries = await tx
      .select({ row: hazidAssessmentCSEntries, person: people })
      .from(hazidAssessmentCSEntries)
      .leftJoin(people, eq(people.id, hazidAssessmentCSEntries.personId))
      .where(eq(hazidAssessmentCSEntries.assessmentId, id))
      .orderBy(asc(hazidAssessmentCSEntries.createdAt))

    // Pickers: full hazard library, hazard sets, task library, sensors, people
    const hazardLibrary = await tx
      .select({ id: hazidHazards.id, name: hazidHazards.name, typeName: hazidHazardTypes.name })
      .from(hazidHazards)
      .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
      .where(isNull(hazidHazards.deletedAt))
      .orderBy(asc(hazidHazards.name))
    const hazardSets = await tx.select().from(hazidHazardSets).orderBy(asc(hazidHazardSets.name))
    const taskLibrary = await tx
      .select({ id: hazidTasks.id, name: hazidTasks.name })
      .from(hazidTasks)
      .where(isNull(hazidTasks.deletedAt))
      .orderBy(asc(hazidTasks.name))
    const sensorList = await tx
      .select({ id: atmosphericSensors.id, identifier: atmosphericSensors.identifier })
      .from(atmosphericSensors)
      .orderBy(asc(atmosphericSensors.identifier))
    const peopleList = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))

    return {
      ...row,
      project,
      tasks,
      hazards,
      ppe,
      questions,
      signatures,
      photos,
      atmospheric,
      entries,
      hazardLibrary,
      hazardSets,
      taskLibrary,
      sensorList,
      peopleList,
    }
  })

  if (!data) notFound()

  const {
    a,
    site,
    type,
    supervisor,
    project,
    tasks,
    hazards,
    ppe,
    questions,
    signatures,
    photos,
    atmospheric,
    entries,
    hazardLibrary,
    hazardSets,
    taskLibrary,
    sensorList,
    peopleList,
  } = data
  const activity = await recentActivityForEntity(ctx, 'hazid_assessment', id, 25)

  const galleryPhotos = photos.map((p) => ({
    id: p.link.id,
    url: publicUrl(p.attachment.r2Key),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const hazardNameLookup = new Map<string, string>(
    hazardLibrary.map((h) => [h.id, h.name] as const),
  )
  const hazardSetWithCount = hazardSets.map((s) => ({
    id: s.id,
    name: s.name,
    count: s.hazardIds.length,
  }))

  const locked = a.locked
  const showWAH = type?.hasWAH && a.wah
  const showCS = type?.hasCS && a.confinedSpace
  const showArc = type?.hasArcFlash && a.arcFlash
  const showPPE = type?.hasPPE ?? true
  const showQ = type?.hasQuestions ?? true
  const showTasks = type?.hasTasks ?? true
  const showHazards = type?.hasHazards ?? true

  const basePath = `/hazid/${id}`

  // Close-href for a drawer in tab X is "?tab=X" (or just basePath for the
  // default Overview tab). This lets the drawer close without changing tabs.
  const tabHref = active === 'overview' ? basePath : `${basePath}?tab=${active}`
  const drawerHref = (key: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams()
    if (active !== 'overview') params.set('tab', active)
    params.set('drawer', key)
    if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, v)
    return `${basePath}?${params.toString()}`
  }

  // Look up rows targeted by edit drawers — done up front so the drawer body
  // can render with the correct initial values. If the id doesn't resolve we
  // simply don't open the drawer (the `open=` predicate stays false).
  const editTaskRow = editTaskId ? tasks.find((t) => t.row.id === editTaskId) : undefined
  const editHazardRow = editHazardId ? hazards.find((h) => h.row.id === editHazardId) : undefined
  const editPPERow = editPPEId ? ppe.find((p) => p.id === editPPEId) : undefined
  const editQuestionRow = editQuestionId
    ? questions.find((q) => q.id === editQuestionId)
    : undefined
  const exitEntryRow = editEntryId ? entries.find((e) => e.row.id === editEntryId) : undefined

  return (
    <DetailPageLayout
      header={
        <>
          <DetailHeader
            back={{ href: '/hazid', label: 'Back to assessments' }}
            title={type?.name ?? 'Hazard assessment'}
            subtitle={`${a.reference} · ${new Date(a.occurredAt).toLocaleString()}`}
            badge={
              <div className="flex items-center gap-2">
                {locked ? (
                  <Badge variant="success">
                    <Lock size={10} /> Locked
                  </Badge>
                ) : (
                  <Badge variant="secondary">In progress</Badge>
                )}
                {showCS ? <Badge variant="warning">Confined space</Badge> : null}
                {showArc ? <Badge variant="destructive">Arc flash</Badge> : null}
                {showWAH ? <Badge variant="outline">Working at heights</Badge> : null}
              </div>
            }
            actions={
              <>
                <Link href={`/hazid/${id}/edit` as any}>
                  <Button variant="outline" disabled={locked}>
                    Edit
                  </Button>
                </Link>
                <Link href={`/hazid/${id}/pdf` as any}>
                  <Button variant="outline">
                    <FileText size={14} /> Print / PDF
                  </Button>
                </Link>
                <Link
                  href={
                    `/hazid/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any
                  }
                  scroll={false}
                >
                  <Button variant="outline">
                    <Mail size={14} /> Send email
                  </Button>
                </Link>
                {/* Copy duplicates this assessment as a new draft, redirects */}
                {/* to the new detail page. Works whether locked or not.     */}
                <form action={copyAssessment}>
                  <input type="hidden" name="id" value={id} />
                  <Button variant="outline" type="submit">
                    <Copy size={14} /> Copy assessment
                  </Button>
                </form>
                {locked ? (
                  <form action={unlockAssessment}>
                    <input type="hidden" name="id" value={id} />
                    <Button variant="outline" type="submit">
                      <Unlock size={14} /> Unlock
                    </Button>
                  </form>
                ) : (
                  <form action={lockAssessment}>
                    <input type="hidden" name="id" value={id} />
                    <Button variant="outline" type="submit">
                      <Lock size={14} /> Lock
                    </Button>
                  </form>
                )}
              </>
            }
          />
        </>
      }
      alerts={
        locked ? (
          <Alert variant="warning">
            <AlertTitle>This assessment is locked</AlertTitle>
            <AlertDescription>
              Locked on {a.lockedAt ? new Date(a.lockedAt).toLocaleString() : '—'}. Unlock to make
              edits (existing signatures will be cleared on unlock).
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
            { key: 'ppe', label: 'PPE', count: ppe.length, hidden: !showPPE },
            { key: 'questions', label: 'Questions', count: questions.length, hidden: !showQ },
            { key: 'tasks', label: 'Tasks', count: tasks.length, hidden: !showTasks },
            { key: 'hazards', label: 'Hazards', count: hazards.length, hidden: !showHazards },
            { key: 'wah', label: 'Fall protection', hidden: !type?.hasWAH },
            {
              key: 'cs',
              label: 'Confined space',
              count: atmospheric.length + entries.length,
              hidden: !type?.hasCS,
            },
            { key: 'arc', label: 'Arc flash', hidden: !type?.hasArcFlash },
            { key: 'signatures', label: 'Signatures', count: signatures.length },
            { key: 'photos', label: 'Photos & files', count: photos.length },
            { key: 'activity', label: 'Activity', count: activity.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <Section title="General Information" subtitle="Who, what, where, when">
              <DetailGrid
                rows={[
                  { label: 'Reference', value: <span className="font-mono">{a.reference}</span> },
                  { label: 'Type', value: type?.name ?? '—' },
                  { label: 'Occurred', value: new Date(a.occurredAt).toLocaleString() },
                  { label: 'Site', value: site?.name ?? '—' },
                  { label: 'Project', value: project?.name ?? '—' },
                  { label: 'Location on site', value: a.locationOnSite ?? '—' },
                  {
                    label: 'Supervisor',
                    value: supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : '—',
                  },
                  {
                    label: 'Locked by',
                    value: a.lockedAt ? new Date(a.lockedAt).toLocaleString() : '—',
                  },
                ]}
              />
              <div className="mt-4">
                <InlineField
                  id={a.id}
                  field="jobScope"
                  initialValue={a.jobScope}
                  label="Job scope"
                  multiline
                  disabled={locked}
                  updateAction={updateTextField}
                  placeholder="Describe the work to be performed."
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {type?.hasWAH ? (
                  <SubFormToggle
                    id={a.id}
                    field="wah"
                    initial={a.wah}
                    label="Working at heights applies"
                    disabled={locked}
                    toggleAction={updateTextField}
                  />
                ) : null}
                {type?.hasCS ? (
                  <SubFormToggle
                    id={a.id}
                    field="confinedSpace"
                    initial={a.confinedSpace}
                    label="Confined space applies"
                    disabled={locked}
                    toggleAction={updateTextField}
                  />
                ) : null}
                {type?.hasArcFlash ? (
                  <SubFormToggle
                    id={a.id}
                    field="arcFlash"
                    initial={a.arcFlash}
                    label="Arc flash applies"
                    disabled={locked}
                    toggleAction={updateTextField}
                  />
                ) : null}
              </div>
            </Section>
          </>
        ) : null}

        {active === 'ppe' && showPPE ? (
          <Section title={`Personal Protective Equipment (${ppe.length})`} defaultOpen>
            <div className="space-y-3">
              {locked ? null : (
                <div className="flex items-center justify-end">
                  <Link href={drawerHref('add-ppe') as any}>
                    <Button type="button" size="sm">
                      <Plus size={12} /> Add PPE
                    </Button>
                  </Link>
                </div>
              )}
              {ppe.length === 0 ? (
                <p className="text-sm text-slate-500">No PPE rows yet.</p>
              ) : (
                <ul className="space-y-2">
                  {ppe.map((row, idx) => (
                    <PPERow
                      key={row.id}
                      row={row}
                      assessmentId={id}
                      index={idx}
                      totalCount={ppe.length}
                      basePath={basePath}
                      activeTab={active}
                      disabled={locked}
                      answerAction={answerPPE}
                      moveAction={movePPE}
                      deleteAction={deletePPE}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Section>
        ) : null}

        {active === 'questions' && showQ ? (
          <Section title={`Questions & Answers (${questions.length})`} defaultOpen>
            <div className="space-y-3">
              {locked ? null : (
                <div className="flex items-center justify-end">
                  <Link href={drawerHref('add-question') as any}>
                    <Button type="button" size="sm">
                      <Plus size={12} /> Add question
                    </Button>
                  </Link>
                </div>
              )}
              {questions.length === 0 ? (
                <p className="text-sm text-slate-500">No questions yet.</p>
              ) : (
                <ul className="space-y-2">
                  {questions.map((row, idx) => (
                    <QuestionRow
                      key={row.id}
                      row={{
                        ...row,
                        questionType: row.questionType as 'yes_no' | 'text' | 'multi_select',
                      }}
                      assessmentId={id}
                      index={idx}
                      totalCount={questions.length}
                      basePath={basePath}
                      activeTab={active}
                      disabled={locked}
                      answerAction={answerQuestion}
                      moveAction={moveQuestion}
                      deleteAction={deleteQuestion}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Section>
        ) : null}

        {active === 'tasks' && showTasks ? (
          <Section title={`Tasks (${tasks.length})`} defaultOpen>
            <div className="space-y-3">
              {locked ? null : (
                <div className="flex items-center justify-end">
                  <Link href={drawerHref('add-task') as any}>
                    <Button type="button" size="sm">
                      <Plus size={12} /> Add task
                    </Button>
                  </Link>
                </div>
              )}
              {tasks.length === 0 ? (
                <p className="text-sm text-slate-500">No tasks yet.</p>
              ) : (
                <ul className="space-y-2">
                  {tasks.map((row, idx) => (
                    <TaskRow
                      key={row.row.id}
                      row={row.row}
                      assessmentId={id}
                      totalCount={tasks.length}
                      index={idx}
                      taskName={row.task?.name ?? null}
                      hazardLookup={hazardNameLookup}
                      basePath={basePath}
                      activeTab={active}
                      disabled={locked}
                      moveAction={moveTask}
                      deleteAction={deleteTask}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Section>
        ) : null}

        {active === 'hazards' && showHazards ? (
          <Section title={`Hazards (${hazards.length})`} defaultOpen>
            <div className="space-y-3">
              {locked ? null : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Link href={drawerHref('add-hazard-library') as any}>
                    <Button type="button" size="sm" variant="outline">
                      <Plus size={12} /> From library
                    </Button>
                  </Link>
                  <Link href={drawerHref('add-hazard-set') as any}>
                    <Button type="button" size="sm" variant="outline">
                      <Plus size={12} /> Add set
                    </Button>
                  </Link>
                  <Link href={drawerHref('add-hazard') as any}>
                    <Button type="button" size="sm">
                      <Plus size={12} /> Ad-hoc hazard
                    </Button>
                  </Link>
                </div>
              )}
              {hazards.length === 0 ? (
                <p className="text-sm text-slate-500">No hazards added yet.</p>
              ) : (
                <ul className="space-y-2">
                  {hazards.map((row, idx) => (
                    <HazardRow
                      key={row.row.id}
                      row={row.row}
                      assessmentId={id}
                      index={idx}
                      totalCount={hazards.length}
                      libraryName={row.library?.name ?? null}
                      basePath={basePath}
                      activeTab={active}
                      disabled={locked}
                      moveAction={moveHazard}
                      deleteAction={deleteHazard}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Section>
        ) : null}

        {active === 'wah' && type?.hasWAH ? (
          <>
            <Section title="Fall Protection Plan (Working at Heights)" defaultOpen>
              <div className="space-y-3">
                {!a.wah ? (
                  <Alert variant="info">
                    <AlertTitle>WAH sub-form not enabled</AlertTitle>
                    <AlertDescription>
                      Turn on "Working at heights applies" on the Overview tab to fill out this
                      section.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <InlineField
                  id={a.id}
                  field="wahType"
                  initialValue={a.wahType}
                  label="WAH type"
                  disabled={locked || !a.wah}
                  updateAction={updateTextField}
                  placeholder="e.g. Roof work, ladder, scaffold"
                />
                <InlineField
                  id={a.id}
                  field="wahCommunication"
                  initialValue={(a.wahCommunication ?? []).join(', ')}
                  label="Communication (comma separated)"
                  disabled={locked || !a.wah}
                  updateAction={updateTextField}
                  placeholder="Radio, hand signals, line of sight"
                />
                <InlineField
                  id={a.id}
                  field="wahAccess"
                  initialValue={(a.wahAccess ?? []).join(', ')}
                  label="Access method(s) (comma separated)"
                  disabled={locked || !a.wah}
                  updateAction={updateTextField}
                  placeholder="Ladder, scissor lift, scaffold"
                />
                <InlineField
                  id={a.id}
                  field="wahEquipment"
                  initialValue={(a.wahEquipment ?? []).join(', ')}
                  label="Equipment used (comma separated)"
                  disabled={locked || !a.wah}
                  updateAction={updateTextField}
                  placeholder="Harness, lanyard, anchor"
                />
                <InlineField
                  id={a.id}
                  field="wahRescue"
                  initialValue={a.wahRescue}
                  label="Rescue plan"
                  multiline
                  disabled={locked || !a.wah}
                  updateAction={updateTextField}
                  placeholder="How will a suspended worker be rescued?"
                />
                <InlineField
                  id={a.id}
                  field="wahPermitNumber"
                  initialValue={a.wahPermitNumber}
                  label="WAH permit number (if applicable)"
                  disabled={locked || !a.wah}
                  updateAction={updateTextField}
                />
              </div>
            </Section>
          </>
        ) : null}

        {active === 'cs' && type?.hasCS ? (
          <>
            <Section title="Confined Space" defaultOpen>
              {!a.confinedSpace ? (
                <Alert variant="info">
                  <AlertTitle>CS sub-form not enabled</AlertTitle>
                  <AlertDescription>
                    Turn on "Confined space applies" on the Overview tab to fill out this section.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <InlineField
                      id={a.id}
                      field="csType"
                      initialValue={a.csType}
                      label="CS form type"
                      disabled={locked}
                      updateAction={updateTextField}
                      placeholder="paper or integrated"
                    />
                    <InlineField
                      id={a.id}
                      field="csPermitNumber"
                      initialValue={a.csPermitNumber}
                      label="CS permit number"
                      disabled={locked}
                      updateAction={updateTextField}
                    />
                  </div>
                  <InlineField
                    id={a.id}
                    field="csDescription"
                    initialValue={a.csDescription}
                    label="Description of confined space"
                    multiline
                    disabled={locked}
                    updateAction={updateTextField}
                    placeholder="What is the space? Tank, vault, vessel..."
                  />
                  <InlineField
                    id={a.id}
                    field="csWorkPerformed"
                    initialValue={a.csWorkPerformed}
                    label="Work to be performed"
                    multiline
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <InlineField
                    id={a.id}
                    field="csCommunication"
                    initialValue={(a.csCommunication ?? []).join(', ')}
                    label="Attendant-to-entrant communication (comma separated)"
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <InlineField
                    id={a.id}
                    field="csCommunicationRescue"
                    initialValue={(a.csCommunicationRescue ?? []).join(', ')}
                    label="Attendant-to-rescue communication (comma separated)"
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <InlineField
                    id={a.id}
                    field="csRescue"
                    initialValue={(a.csRescue ?? []).join(', ')}
                    label="Rescue equipment (comma separated)"
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <InlineField
                    id={a.id}
                    field="csRescueStyle"
                    initialValue={a.csRescueStyle}
                    label="Rescue style"
                    disabled={locked}
                    updateAction={updateTextField}
                    placeholder="entry or non_entry"
                  />
                  <InlineField
                    id={a.id}
                    field="csRescueProcedure"
                    initialValue={a.csRescueProcedure}
                    label="Rescue procedure"
                    multiline
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <div>
                    <div className="mb-1 text-xs tracking-wide text-slate-500 uppercase">
                      Space diagram
                    </div>
                    <CSDiagram
                      assessmentId={a.id}
                      initial={a.csDiagramBase64}
                      disabled={locked}
                      saveAction={updateTextField}
                    />
                  </div>
                </div>
              )}
            </Section>

            <Section title={`Atmospheric readings (${atmospheric.length})`} defaultOpen>
              <div className="space-y-3">
                {locked || !a.confinedSpace ? null : (
                  <div className="flex items-center justify-end">
                    <Link href={drawerHref('add-cs-reading') as any}>
                      <Button type="button" size="sm">
                        <Plus size={12} /> Add reading
                      </Button>
                    </Link>
                  </div>
                )}
                {atmospheric.length === 0 ? (
                  <p className="text-sm text-slate-500">No readings logged.</p>
                ) : (
                  <ul className="space-y-2">
                    {atmospheric.map((r) => (
                      <li
                        key={r.row.id}
                        className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto]"
                      >
                        <div className="space-y-1">
                          <div className="text-xs tracking-wide text-slate-500 uppercase">
                            {new Date(r.row.time).toLocaleString()}
                            {r.sensor ? ` · ${r.sensor.identifier}` : ''}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-slate-700">
                            {r.row.sensor1Reading ? <span>O₂: {r.row.sensor1Reading}%</span> : null}
                            {r.row.sensor2Reading ? (
                              <span>LEL: {r.row.sensor2Reading}%</span>
                            ) : null}
                            {r.row.sensor3Reading ? (
                              <span>CO: {r.row.sensor3Reading} ppm</span>
                            ) : null}
                            {r.row.sensor4Reading ? (
                              <span>H₂S: {r.row.sensor4Reading} ppm</span>
                            ) : null}
                          </div>
                          {r.row.distance ? (
                            <div className="text-xs text-slate-500">{r.row.distance}</div>
                          ) : null}
                          {r.row.notes ? (
                            <div className="text-xs text-slate-500">{r.row.notes}</div>
                          ) : null}
                        </div>
                        {locked ? null : (
                          <form action={deleteCSAtmospheric}>
                            <input type="hidden" name="id" value={r.row.id} />
                            <input type="hidden" name="assessmentId" value={id} />
                            <Button type="submit" size="sm" variant="ghost">
                              Delete
                            </Button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>

            <Section title={`Entry log (${entries.length})`} defaultOpen>
              <div className="space-y-3">
                {locked || !a.confinedSpace ? null : (
                  <div className="flex items-center justify-end">
                    <Link href={drawerHref('add-cs-entry') as any}>
                      <Button type="button" size="sm">
                        <Plus size={12} /> Log entry
                      </Button>
                    </Link>
                  </div>
                )}
                {entries.length === 0 ? (
                  <p className="text-sm text-slate-500">No entries logged.</p>
                ) : (
                  <ul className="space-y-2">
                    {entries.map((r) => {
                      const personLabel = r.person
                        ? `${r.person.firstName} ${r.person.lastName}`
                        : (r.row.externalName ?? 'Unknown')
                      return (
                        <li
                          key={r.row.id}
                          className="grid grid-cols-1 items-center gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto_auto]"
                        >
                          <div>
                            <div className="font-medium text-slate-900">{personLabel}</div>
                            <div className="text-xs text-slate-500">
                              In: {r.row.timeIn ? new Date(r.row.timeIn).toLocaleString() : '—'}
                              {r.row.timeOut
                                ? ` · Out: ${new Date(r.row.timeOut).toLocaleString()}`
                                : ' · Still inside'}
                            </div>
                          </div>
                          {!r.row.timeOut && !locked ? (
                            <Link href={drawerHref('exit-cs-entry', { entryId: r.row.id }) as any}>
                              <Button type="button" size="sm">
                                Sign out
                              </Button>
                            </Link>
                          ) : (
                            <span />
                          )}
                          {locked ? null : (
                            <form action={deleteCSEntry}>
                              <input type="hidden" name="id" value={r.row.id} />
                              <input type="hidden" name="assessmentId" value={id} />
                              <Button type="submit" size="sm" variant="ghost">
                                Delete
                              </Button>
                            </form>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </Section>
          </>
        ) : null}

        {active === 'arc' && type?.hasArcFlash ? (
          <>
            <Section title="Arc Flash Protection" defaultOpen>
              {!a.arcFlash ? (
                <Alert variant="info">
                  <AlertTitle>Arc-flash sub-form not enabled</AlertTitle>
                  <AlertDescription>
                    Turn on "Arc flash applies" on the Overview tab to fill out this section.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  <InlineField
                    id={a.id}
                    field="arcFlashLevel"
                    initialValue={a.arcFlashLevel}
                    label="Hazard / Risk Category (HRC)"
                    disabled={locked}
                    updateAction={updateTextField}
                    placeholder="HRC 0–4"
                  />
                  <InlineField
                    id={a.id}
                    field="arcFlashBoundary"
                    initialValue={a.arcFlashBoundary}
                    label="Arc flash boundary"
                    disabled={locked}
                    updateAction={updateTextField}
                    placeholder="e.g. 36 inches"
                  />
                  <InlineField
                    id={a.id}
                    field="arcFlashIncidentEnergy"
                    initialValue={a.arcFlashIncidentEnergy}
                    label="Incident energy (cal/cm²)"
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <InlineField
                    id={a.id}
                    field="arcFlashEquipment"
                    initialValue={(a.arcFlashEquipment ?? []).join(', ')}
                    label="Required arc-flash PPE (comma separated)"
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <InlineField
                    id={a.id}
                    field="arcFlashProcedures"
                    initialValue={a.arcFlashProcedures}
                    label="Procedures"
                    multiline
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <InlineField
                    id={a.id}
                    field="arcFlashQualifiedPerson"
                    initialValue={a.arcFlashQualifiedPerson}
                    label="Qualified person"
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </div>
              )}
            </Section>

            <Section title="CSA Z462 protection-level reference" defaultOpen={false}>
              <ArcFlashReferenceTable />
            </Section>
          </>
        ) : null}

        {active === 'signatures' ? (
          <Section title={`Signatures (${signatures.length})`} defaultOpen>
            <div className="space-y-3">
              {locked ? null : (
                <div className="flex items-center justify-end">
                  <Link href={drawerHref('add-signature') as any}>
                    <Button type="button" size="sm">
                      <Plus size={12} /> Add signature
                    </Button>
                  </Link>
                </div>
              )}
              {signatures.length === 0 ? (
                <p className="text-sm text-slate-500">No signatures captured.</p>
              ) : (
                <ul className="space-y-2">
                  {signatures.map((s) => (
                    <li
                      key={s.row.id}
                      className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <div className="font-medium text-slate-900">
                          {s.person
                            ? `${s.person.firstName} ${s.person.lastName}`
                            : (s.row.externalName ?? 'Unknown')}
                          <span className="ml-2 text-xs text-slate-500 uppercase">
                            {s.row.signatureType}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                          {s.row.csEntrant ? <span>Entrant</span> : null}
                          {s.row.csAttendant ? <span>Attendant</span> : null}
                          {s.row.csRescue ? <span>Rescue</span> : null}
                          {s.row.signedAt ? (
                            <span>Signed {new Date(s.row.signedAt).toLocaleString()}</span>
                          ) : (
                            <span className="text-red-600">Not signed</span>
                          )}
                        </div>
                        {s.row.signatureDataUrl ? (
                          <img
                            src={s.row.signatureDataUrl}
                            alt={`Signature`}
                            className="mt-2 h-16 max-w-xs rounded border border-slate-200 bg-white object-contain"
                          />
                        ) : null}
                      </div>
                      {!locked ? (
                        <form action={deleteSignature}>
                          <input type="hidden" name="id" value={s.row.id} />
                          <input type="hidden" name="assessmentId" value={id} />
                          <Button type="submit" size="sm" variant="ghost">
                            Delete
                          </Button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        ) : null}

        {active === 'photos' ? (
          <Section title={`Photos & files (${photos.length})`} defaultOpen>
            <div className="space-y-3">
              <PhotoGallery photos={galleryPhotos} />
              {!locked ? (
                <HazidPhotoUploader assessmentId={id} attachAction={attachPhotos} />
              ) : null}
              {!locked && photos.length > 0 ? (
                <ul className="space-y-1 text-xs text-slate-500">
                  {photos.map((p) => (
                    <li key={p.link.id} className="flex items-center justify-between">
                      <span>{p.attachment.filename}</span>
                      <form action={deletePhoto}>
                        <input type="hidden" name="id" value={p.link.id} />
                        <input type="hidden" name="assessmentId" value={id} />
                        <button type="submit" className="text-red-600 hover:underline">
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Section>
        ) : null}

        {active === 'activity' ? (
          <Section title={`Activity (${activity.length})`} defaultOpen>
            <ActivityFeed entries={activity} />
          </Section>
        ) : null}
      </div>

      {/* ============================================================== */}
      {/* Drawers — one per drawer key. Each is `open` only when the URL */}
      {/* `?drawer=` matches AND the row lookup (if any) succeeded.      */}
      {/* ============================================================== */}

      {/* Tasks */}
      <UrlDrawer
        open={drawerKey === 'add-task'}
        closeHref={tabHref}
        title="Add task"
        description="Pick from the task library or describe an ad-hoc task."
        size="md"
      >
        <AddTaskDrawerBody
          assessmentId={id}
          taskLibrary={taskLibrary}
          closeHref={tabHref}
          addAction={addTask}
        />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'edit-task' && !!editTaskRow}
        closeHref={tabHref}
        title="Edit task"
        size="md"
      >
        {editTaskRow ? (
          <EditTaskDrawerBody
            assessmentId={id}
            closeHref={tabHref}
            row={editTaskRow.row}
            taskName={editTaskRow.task?.name ?? null}
            hazardLookup={hazardNameLookup}
            updateAction={updateTask}
          />
        ) : null}
      </UrlDrawer>

      {/* Hazards */}
      <UrlDrawer
        open={drawerKey === 'add-hazard-library'}
        closeHref={tabHref}
        title="Add hazard from library"
        size="md"
      >
        <AddHazardLibraryDrawerBody
          assessmentId={id}
          hazardLibrary={hazardLibrary}
          closeHref={tabHref}
          addAction={addHazard}
        />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'add-hazard-set'}
        closeHref={tabHref}
        title="Add hazard set"
        description="Bulk-add a curated list of hazards."
        size="md"
      >
        <AddHazardSetDrawerBody
          assessmentId={id}
          hazardSets={hazardSetWithCount}
          closeHref={tabHref}
          addSetAction={addHazardSet}
        />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'add-hazard'}
        closeHref={tabHref}
        title="Add ad-hoc hazard"
        size="md"
      >
        <AddHazardDrawerBody assessmentId={id} closeHref={tabHref} addAction={addHazard} />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'edit-hazard' && !!editHazardRow}
        closeHref={tabHref}
        title="Edit hazard"
        size="md"
      >
        {editHazardRow ? (
          <EditHazardDrawerBody
            assessmentId={id}
            closeHref={tabHref}
            row={editHazardRow.row}
            libraryName={editHazardRow.library?.name ?? null}
            updateAction={updateHazard}
          />
        ) : null}
      </UrlDrawer>

      {/* PPE */}
      <UrlDrawer open={drawerKey === 'add-ppe'} closeHref={tabHref} title="Add PPE" size="md">
        <AddPPEDrawerBody assessmentId={id} closeHref={tabHref} addAction={addPPE} />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'edit-ppe' && !!editPPERow}
        closeHref={tabHref}
        title="Edit PPE"
        size="md"
      >
        {editPPERow ? (
          <EditPPEDrawerBody
            assessmentId={id}
            closeHref={tabHref}
            row={editPPERow}
            updateAction={updatePPE}
          />
        ) : null}
      </UrlDrawer>

      {/* Questions */}
      <UrlDrawer
        open={drawerKey === 'add-question'}
        closeHref={tabHref}
        title="Add question"
        size="md"
      >
        <AddQuestionDrawerBody assessmentId={id} closeHref={tabHref} addAction={addQuestion} />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'edit-question' && !!editQuestionRow}
        closeHref={tabHref}
        title="Edit question"
        size="md"
      >
        {editQuestionRow ? (
          <EditQuestionDrawerBody
            assessmentId={id}
            closeHref={tabHref}
            row={{
              ...editQuestionRow,
              questionType: editQuestionRow.questionType as 'yes_no' | 'text' | 'multi_select',
            }}
            updateAction={updateQuestion}
          />
        ) : null}
      </UrlDrawer>

      {/* CS Atmospheric */}
      <UrlDrawer
        open={drawerKey === 'add-cs-reading'}
        closeHref={tabHref}
        title="Add atmospheric reading"
        size="md"
      >
        <AddAtmosphericDrawerBody
          assessmentId={id}
          sensors={sensorList}
          closeHref={tabHref}
          addAction={addCSAtmospheric}
        />
      </UrlDrawer>

      {/* CS Entry log */}
      <UrlDrawer
        open={drawerKey === 'add-cs-entry'}
        closeHref={tabHref}
        title="Log confined-space entry"
        size="md"
      >
        <AddEntryDrawerBody
          assessmentId={id}
          people={peopleList}
          closeHref={tabHref}
          addAction={addCSEntry}
        />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'exit-cs-entry' && !!exitEntryRow}
        closeHref={tabHref}
        title="Mark entry exited"
        size="sm"
      >
        {exitEntryRow ? (
          <ExitEntryDrawerBody
            assessmentId={id}
            closeHref={tabHref}
            row={{ id: exitEntryRow.row.id, timeIn: exitEntryRow.row.timeIn }}
            personLabel={
              exitEntryRow.person
                ? `${exitEntryRow.person.firstName} ${exitEntryRow.person.lastName}`
                : (exitEntryRow.row.externalName ?? 'Unknown')
            }
            exitAction={exitCSEntry}
          />
        ) : null}
      </UrlDrawer>

      {/* Signatures */}
      <UrlDrawer
        open={drawerKey === 'add-signature'}
        closeHref={tabHref}
        title="Add signature"
        size="md"
      >
        <AddSignatureDrawerBody
          assessmentId={id}
          people={peopleList}
          showCSRoles={Boolean(showCS)}
          closeHref={tabHref}
          addAction={addSignature}
        />
      </UrlDrawer>

      <GenericSendEmailDialog
        open={pickString(sp.send) === '1'}
        title="Send hazard assessment"
        description="Sends a structured recap email to the tenant admin distribution list by default, or to the explicit recipients below."
        reference={a.reference}
        defaultSubjectPrefix="Update"
        sendAction={async (fd) => {
          'use server'
          fd.set('id', id)
          await sendEmailAction(fd)
        }}
      />
    </DetailPageLayout>
  )
}

// CSA Z462 reference rows — copied from the legacy view for parity.
function ArcFlashReferenceTable() {
  const rows = [
    {
      hrc: 'HRC 0',
      energy: '< 1.2 cal/cm²',
      ppe: 'Untreated cotton (long sleeves + pants). Safety glasses. Hearing.',
    },
    {
      hrc: 'HRC 1',
      energy: '4 cal/cm²',
      ppe: 'Arc-rated FR shirt/pants or coverall. Arc-rated face shield + balaclava. Hard hat.',
    },
    {
      hrc: 'HRC 2',
      energy: '8 cal/cm²',
      ppe: 'Arc-rated FR shirt/pants/coverall. Arc-rated face shield + balaclava OR arc-flash suit hood. Hard hat. Leather gloves.',
    },
    {
      hrc: 'HRC 3',
      energy: '25 cal/cm²',
      ppe: 'Arc-flash suit (40 cal/cm² rated). Arc-flash hood. Insulated rubber gloves with leather protectors. Hearing.',
    },
    {
      hrc: 'HRC 4',
      energy: '40 cal/cm²',
      ppe: 'Arc-flash suit (40 cal/cm² rated). Arc-flash hood. Insulated rubber gloves with leather protectors. Hearing. Additional layers as needed.',
    },
  ]
  return (
    <table className="w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
        <tr>
          <th className="px-3 py-2 text-left">Category</th>
          <th className="px-3 py-2 text-left">Incident energy</th>
          <th className="px-3 py-2 text-left">Required PPE (CSA Z462)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.hrc}>
            <td className="px-3 py-2 font-medium text-slate-900">{r.hrc}</td>
            <td className="px-3 py-2 text-slate-600">{r.energy}</td>
            <td className="px-3 py-2 text-slate-600">{r.ppe}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
