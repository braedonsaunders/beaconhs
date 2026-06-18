import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  UrlDrawer,
} from '@beaconhs/ui'
import {
  AlertTriangle,
  Building2,
  Camera,
  CheckCircle2,
  FileText,
  HelpCircle,
  History,
  LayoutGrid,
  ListChecks,
  Lock,
  PenLine,
  PlayCircle,
  Plus,
  Shield,
  Trash2,
} from 'lucide-react'
import {
  attachments,
  formResponses,
  formTemplates,
  formTemplateVersions,
  hazidAssessmentAppResponses,
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentPhotos,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypeApps,
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
import { canManageModule } from '@/lib/module-admin/guard'
import { recentActivityForEntity } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { sendHazidEmail } from './_send-email'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { loadEntitiesForPickers } from '@/app/(app)/forms/_lib/entity-loader'
import { FormRenderer } from '@/app/(app)/forms/templates/[id]/fill/form-renderer'
import type { EntityAttrsByField, FormSchemaV1 } from '@beaconhs/forms-core'
import { PhotoGallery } from '@/components/photo-gallery'
import { PremiumSection as Section } from '@/components/premium-section'
import {
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
  deleteAssessment,
  deleteHazard,
  deletePPE,
  deletePhoto,
  deleteQuestion,
  deleteSignature,
  deleteTask,
  lockAssessment,
  moveHazard,
  movePPE,
  moveQuestion,
  moveTask,
  unlockAssessment,
  openAssessmentApp,
  updateHazard,
  updatePPE,
  updateQuestion,
  updateTask,
  updateTextField,
} from '../_actions'
import {
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
  HazardRow,
  PPERow,
  QuestionRow,
  TaskRow,
} from './_sections'
import { AssessmentHeaderActions } from './_header-actions'
import { SectionNav, type SectionNavItem } from '@/components/section-nav'
import { LiveDateTime, LiveField, LivePersonSelect, LiveSelect } from '@/components/live-field'
import { localDatetimeValue } from '../_datetime'
import { AddSignatureDrawerBody } from '../_signature-form'
import { HazidPhotoUploader } from '../_photo-uploader'
import { RiskScoreBadge } from '../_risk'

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
  revalidatePath(`/hazard-assessments/${id}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Hazard assessment · ${id.slice(0, 8)}` }
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
  const ctx = await requireRequestContext()
  const drawerKey = pickString(sp.drawer) ?? ''
  const appParam = pickString(sp.app) ?? ''
  const editTaskId = pickString(sp.taskId) ?? ''
  const editHazardId = pickString(sp.hazardId) ?? ''
  const editPPEId = pickString(sp.ppeId) ?? ''
  const editQuestionId = pickString(sp.questionId) ?? ''

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
    const typeApps = row.a.assessmentTypeId
      ? await tx
          .select({ app: hazidAssessmentTypeApps, template: formTemplates })
          .from(hazidAssessmentTypeApps)
          .innerJoin(formTemplates, eq(formTemplates.id, hazidAssessmentTypeApps.templateId))
          .where(
            and(
              eq(hazidAssessmentTypeApps.typeId, row.a.assessmentTypeId),
              isNull(hazidAssessmentTypeApps.deletedAt),
            ),
          )
          .orderBy(asc(hazidAssessmentTypeApps.entityOrder))
      : []
    const appResponses =
      typeApps.length > 0
        ? await tx
            .select({ link: hazidAssessmentAppResponses, response: formResponses })
            .from(hazidAssessmentAppResponses)
            .innerJoin(formResponses, eq(formResponses.id, hazidAssessmentAppResponses.responseId))
            .where(eq(hazidAssessmentAppResponses.assessmentId, id))
            .orderBy(asc(hazidAssessmentAppResponses.entityOrder))
        : []

    // The form is one page; heavyweight pickers load only while their drawer
    // is actually open (opening a drawer is a server navigation anyway), so a
    // field phone never pays for the full libraries just to read the form.
    const wantHazardLibrary = drawerKey === 'add-hazard-library'
    const wantHazardSets = drawerKey === 'add-hazard-set'
    const wantTaskLibrary = drawerKey === 'add-task'
    const wantPeople = true // supervisor select + signatures

    // Hazard names referenced by task rows (chips) — a tiny targeted lookup
    // instead of the whole hazard library.
    const referencedHazardIds = [...new Set(tasks.flatMap((t) => t.row.hazardIds))]
    const referencedHazards =
      referencedHazardIds.length > 0
        ? await tx
            .select({ id: hazidHazards.id, name: hazidHazards.name })
            .from(hazidHazards)
            .where(inArray(hazidHazards.id, referencedHazardIds))
        : []

    // General-info pickers for the inline (live) selects.
    const siteOptions = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const projectOptions = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      // active jobs only, plus this assessment's current project even if it was archived
      .where(
        and(
          eq(orgUnits.level, 'project'),
          or(
            isNull(orgUnits.deletedAt),
            row.a.projectOrgUnitId ? eq(orgUnits.id, row.a.projectOrgUnitId) : undefined,
          ),
        ),
      )
      .orderBy(asc(orgUnits.name))
    const typeOptions = await tx
      .select({ id: hazidAssessmentTypes.id, name: hazidAssessmentTypes.name })
      .from(hazidAssessmentTypes)
      .where(isNull(hazidAssessmentTypes.deletedAt))
      .orderBy(asc(hazidAssessmentTypes.name))

    const hazardLibrary = wantHazardLibrary
      ? await tx
          .select({ id: hazidHazards.id, name: hazidHazards.name, typeName: hazidHazardTypes.name })
          .from(hazidHazards)
          .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
          .where(isNull(hazidHazards.deletedAt))
          .orderBy(asc(hazidHazards.name))
      : []
    const hazardSets = wantHazardSets
      ? await tx.select().from(hazidHazardSets).orderBy(asc(hazidHazardSets.name))
      : []
    const taskLibrary = wantTaskLibrary
      ? await tx
          .select({ id: hazidTasks.id, name: hazidTasks.name })
          .from(hazidTasks)
          .where(isNull(hazidTasks.deletedAt))
          .orderBy(asc(hazidTasks.name))
      : []
    const peopleList = wantPeople
      ? await tx
          .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
          .from(people)
          .where(eq(people.status, 'active'))
          .orderBy(asc(people.lastName), asc(people.firstName))
      : []

    return {
      ...row,
      project,
      tasks,
      hazards,
      ppe,
      questions,
      signatures,
      photos,
      typeApps,
      appResponses,
      hazardLibrary,
      hazardSets,
      taskLibrary,
      peopleList,
      referencedHazards,
      siteOptions,
      projectOptions,
      typeOptions,
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
    typeApps,
    appResponses,
    hazardLibrary,
    hazardSets,
    taskLibrary,
    peopleList,
    referencedHazards,
    siteOptions,
    projectOptions,
    typeOptions,
  } = data
  // Single unified page: anyone in the tenant edits an unlocked assessment;
  // module managers additionally get the destructive actions (delete).
  const canManage = canManageModule(ctx, 'hazid')
  const activity = await recentActivityForEntity(ctx, 'hazid_assessment', id, 25)

  // Inline app fill: when `?app=<typeAppId>` is present we render the embedded
  // Builder app full-screen over the assessment (no navigating away). Reuses
  // the same FormRenderer the standalone fill page uses.
  let appFill: {
    templateId: string
    templateName: string
    version: number
    schema: FormSchemaV1
    sites: { id: string; name: string }[]
    people: { id: string; firstName: string; lastName: string; employeeNo: string | null }[]
    entitiesByField: EntityAttrsByField
    currentUser: { personId: string | null; name: string | null }
    responseId: string
    initialValues: Record<string, unknown>
    initialRows: Record<string, Array<Record<string, unknown>>>
    initialStepIndex: number
    resumeOk: boolean
  } | null = null
  if (appParam) {
    const typeApp = typeApps.find((t) => t.app.id === appParam)
    const linked = appResponses.find((r) => r.link.typeAppId === appParam)
    if (typeApp && linked) {
      const loaded = await ctx.db(async (tx) => {
        const [version] = await tx
          .select()
          .from(formTemplateVersions)
          .where(eq(formTemplateVersions.templateId, typeApp.app.templateId))
          .orderBy(desc(formTemplateVersions.version))
          .limit(1)
        if (!version) return null
        const [sitesList, allPeople, currentPersonRow] = await Promise.all([
          tx
            .select({ id: orgUnits.id, name: orgUnits.name })
            .from(orgUnits)
            .where(eq(orgUnits.level, 'site'))
            .orderBy(asc(orgUnits.name)),
          tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              employeeNo: people.employeeNo,
            })
            .from(people)
            .where(eq(people.status, 'active'))
            .orderBy(asc(people.lastName), asc(people.firstName)),
          tx
            .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
            .from(people)
            .where(eq(people.userId, ctx.userId ?? ''))
            .limit(1),
        ])
        return { version, sitesList, allPeople, currentPerson: currentPersonRow[0] ?? null }
      })
      if (loaded) {
        const resp = linked.response
        const resumeOk =
          (resp.status === 'draft' || resp.status === 'in_progress') && resp.draftData !== null
        const draft = resp.draftData
        const initialValues = resumeOk ? (draft?.values ?? {}) : {}
        const initialRows = resumeOk ? (draft?.rows ?? {}) : {}
        const initialStepIndex = resumeOk ? (resp.draftStepIndex ?? 0) : 0
        const entitiesByField = await loadEntitiesForPickers(
          ctx,
          loaded.version.schema,
          initialValues,
        )
        appFill = {
          templateId: typeApp.app.templateId,
          templateName: typeApp.app.label || typeApp.template.name,
          version: loaded.version.version,
          schema: loaded.version.schema,
          sites: loaded.sitesList,
          people: loaded.allPeople,
          entitiesByField,
          currentUser: {
            personId: loaded.currentPerson?.id ?? null,
            name: loaded.currentPerson
              ? `${loaded.currentPerson.firstName} ${loaded.currentPerson.lastName}`
              : (ctx.membership?.displayName ?? null),
          },
          responseId: resp.id,
          initialValues,
          initialRows,
          initialStepIndex,
          resumeOk,
        }
      }
    }
  }

  const galleryPhotos = photos.map((p) => ({
    id: p.link.id,
    url: publicUrl(p.attachment.r2Key),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const hazardNameLookup = new Map<string, string>(
    [...referencedHazards, ...hazardLibrary].map((h) => [h.id, h.name] as const),
  )
  const hazardSetWithCount = hazardSets.map((s) => ({
    id: s.id,
    name: s.name,
    count: s.hazardIds.length,
  }))
  const appResponseByTypeAppId = new Map(
    appResponses
      .filter((r) => r.link.typeAppId)
      .map((r) => [r.link.typeAppId!, { link: r.link, response: r.response }] as const),
  )
  const embeddedApps = typeApps.map(({ app, template }) => {
    const linked = appResponseByTypeAppId.get(app.id)
    const status = linked?.response.status ?? null
    const done = status === 'submitted' || status === 'non_compliant' || status === 'closed'
    const started = Boolean(linked)
    return {
      app,
      template,
      link: linked?.link ?? null,
      response: linked?.response ?? null,
      status,
      done,
      started,
    }
  })
  const requiredEmbeddedApps = embeddedApps.filter((item) => item.app.required)
  const requiredEmbeddedDone = requiredEmbeddedApps.filter((item) => item.done).length

  const locked = a.locked
  const showPPE = type?.hasPPE ?? true
  const showQ = type?.hasQuestions ?? true
  const showTasks = type?.hasTasks ?? true
  const showHazards = type?.hasHazards ?? true

  // ------------------------------------------------------------------
  // Readiness — how complete is this assessment? Drives the progress
  // strip on the Overview tab and the pre-lock warnings.
  // ------------------------------------------------------------------
  const ppeAnswered = ppe.filter((p) => p.answer != null).length
  const questionsAnswered = questions.filter((q) => (q.answer ?? '').trim().length > 0).length
  const requiresYesViolations = questions.filter(
    (q) => q.requiresYes && (q.answer ?? '').trim().length > 0 && q.answer?.toLowerCase() !== 'yes',
  )
  const applicableHazards = hazards.filter((h) => h.row.applicable)
  const hazardsRated = applicableHazards.filter(
    (h) => h.row.preLikelihood != null && h.row.preSeverity != null,
  ).length
  const signedCount = signatures.filter((s) => s.row.signatureDataUrl).length
  const highestResidual = applicableHazards.reduce<{ l: number; s: number } | null>((acc, h) => {
    const l = h.row.postLikelihood ?? h.row.preLikelihood
    const s = h.row.postSeverity ?? h.row.preSeverity
    if (l == null || s == null) return acc
    if (!acc || l * s > acc.l * acc.s) return { l, s }
    return acc
  }, null)

  const readiness: {
    label: string
    done: number
    total: number
    href?: string
  }[] = []
  if (showPPE) readiness.push({ label: 'PPE confirmed', done: ppeAnswered, total: ppe.length })
  if (showQ)
    readiness.push({
      label: 'Questions answered',
      done: questionsAnswered,
      total: questions.length,
    })
  if (showHazards)
    readiness.push({
      label: 'Hazards risk-rated',
      done: hazardsRated,
      total: applicableHazards.length,
    })
  if (requiredEmbeddedApps.length > 0)
    readiness.push({
      label: 'Apps submitted',
      done: requiredEmbeddedDone,
      total: requiredEmbeddedApps.length,
    })
  readiness.push({ label: 'Signatures collected', done: signedCount, total: signatures.length })

  // Overall completion across every readiness metric — drives the hero ring.
  const overallTotal = readiness.reduce((acc, r) => acc + r.total, 0)
  const overallDone = readiness.reduce((acc, r) => acc + Math.min(r.done, r.total), 0)
  const overallPct = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0
  const ringCirc = 2 * Math.PI * 26

  // One-page form: these drive the sticky jump-nav (scroll, not navigation).
  const sectionItems: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    ...(showPPE
      ? [
          {
            id: 'ppe',
            label: 'PPE',
            count: ppe.length,
            done: ppe.length > 0 && ppeAnswered === ppe.length,
          },
        ]
      : []),
    ...(showQ
      ? [
          {
            id: 'questions',
            label: 'Questions',
            count: questions.length,
            done: questions.length > 0 && questionsAnswered === questions.length,
          },
        ]
      : []),
    ...(showTasks ? [{ id: 'tasks', label: 'Tasks', count: tasks.length }] : []),
    ...(showHazards
      ? [
          {
            id: 'hazards',
            label: 'Hazards',
            count: hazards.length,
            done: applicableHazards.length > 0 && hazardsRated === applicableHazards.length,
          },
        ]
      : []),
    ...(embeddedApps.length > 0
      ? [
          {
            id: 'apps',
            label: 'Apps',
            count: embeddedApps.length,
            done:
              requiredEmbeddedApps.length > 0 &&
              requiredEmbeddedDone === requiredEmbeddedApps.length,
          },
        ]
      : []),
    { id: 'photos', label: 'Photos', count: photos.length },
    {
      id: 'signatures',
      label: 'Sign-off',
      count: signatures.length,
      done: signatures.length > 0 && signedCount === signatures.length,
    },
    { id: 'activity', label: 'Activity' },
  ]

  const basePath = `/hazard-assessments/${id}`

  const tabHref = basePath
  const drawerHref = (key: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams()
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
  return (
    <DetailPageLayout
      header={
        <>
          <DetailHeader
            back={{ href: '/hazard-assessments', label: 'Back to assessments' }}
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
              </div>
            }
            actions={
              <AssessmentHeaderActions
                id={id}
                locked={locked}
                canManage={canManage}
                pdfHref={`/hazard-assessments/${id}/pdf`}
                emailHref={`/hazard-assessments/${id}?send=1`}
                deleteHref={drawerHref('confirm-delete')}
                copyAction={copyAssessment}
                lockAction={lockAssessment}
                unlockAction={unlockAssessment}
              />
            }
          />
        </>
      }
      alerts={
        <>
          {locked ? (
            <Alert variant="warning">
              <AlertTitle>This assessment is locked</AlertTitle>
              <AlertDescription>
                Locked on {a.lockedAt ? new Date(a.lockedAt).toLocaleString() : '—'}. Unlock to make
                edits (existing signatures will be cleared on unlock).
              </AlertDescription>
            </Alert>
          ) : null}
          {requiresYesViolations.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>
                {requiresYesViolations.length} compliance question
                {requiresYesViolations.length === 1 ? '' : 's'} answered "No"
              </AlertTitle>
              <AlertDescription>
                {requiresYesViolations
                  .map((q) => q.question)
                  .slice(0, 3)
                  .join(' · ')}
                {requiresYesViolations.length > 3 ? ' · …' : ''} — resolve before work proceeds.
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      subtabs={<SectionNav sections={sectionItems} />}
    >
      <div className="ff-surface space-y-5">
        <section id="section-overview" className="scroll-mt-2 space-y-5">
          <>
            {/* Readiness strip — at-a-glance completeness + worst residual risk */}
            {/* Overview hero — overall completion ring + worst residual risk */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-4">
                <div className="relative h-16 w-16 shrink-0">
                  <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
                    <circle
                      cx="32"
                      cy="32"
                      r="26"
                      fill="none"
                      strokeWidth="6"
                      className="stroke-slate-200 dark:stroke-slate-700"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r="26"
                      fill="none"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={ringCirc}
                      strokeDashoffset={ringCirc * (1 - overallPct / 100)}
                      className={overallPct >= 100 ? 'stroke-emerald-500' : 'stroke-teal-500'}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {overallPct}%
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {overallDone} of {overallTotal} steps complete
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                    {type?.name ?? 'Hazard assessment'}
                    {site ? ` · ${site.name}` : ''}
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  Highest residual risk
                </div>
                <div className="mt-1.5">
                  <RiskScoreBadge
                    likelihood={highestResidual?.l ?? null}
                    severity={highestResidual?.s ?? null}
                  />
                </div>
              </div>
            </div>

            {/* Readiness tiles */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {readiness.map((r) => {
                const complete = r.total > 0 && r.done >= r.total
                const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0
                return (
                  <div
                    key={r.label}
                    className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-baseline justify-between">
                      <span
                        className={`text-2xl font-semibold ${complete ? 'text-emerald-600' : 'text-slate-900 dark:text-slate-100'}`}
                      >
                        {r.done}
                        <span className="text-sm font-normal text-slate-400">/{r.total}</span>
                      </span>
                      {complete ? (
                        <CheckCircle2 size={18} className="text-emerald-500" />
                      ) : (
                        <span className="text-xs font-medium text-slate-400">{pct}%</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                      {r.label}
                    </div>
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${complete ? 'bg-emerald-500' : 'bg-teal-500'}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <Section
              title="General Information"
              subtitle="Who, what, where, when"
              icon={<Building2 size={20} />}
              tone="slate"
            >
              {/* Live fields — the input on the page IS the field; everything
                  auto-saves, nothing hides behind an edit step. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LiveSelect
                  id={a.id}
                  field="assessmentTypeId"
                  label="Assessment type"
                  initialValue={a.assessmentTypeId}
                  options={typeOptions.map((t) => ({ value: t.id, label: t.name }))}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveDateTime
                  id={a.id}
                  field="occurredAt"
                  label="Date & time"
                  initialValue={localDatetimeValue(new Date(a.occurredAt))}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LivePersonSelect
                  id={a.id}
                  field="supervisorPersonId"
                  label="Supervisor"
                  initialValue={a.supervisorPersonId}
                  options={peopleList.map((p) => ({
                    value: p.id,
                    label: `${p.lastName}, ${p.firstName}`,
                    hint: [p.firstName, p.lastName].filter(Boolean).join(' '),
                  }))}
                  sheetTitle="Select supervisor"
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveSelect
                  id={a.id}
                  field="siteOrgUnitId"
                  label="Site"
                  initialValue={a.siteOrgUnitId}
                  options={siteOptions.map((s) => ({ value: s.id, label: s.name }))}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveSelect
                  id={a.id}
                  field="projectOrgUnitId"
                  label="Project"
                  initialValue={a.projectOrgUnitId}
                  options={projectOptions.map((p) => ({ value: p.id, label: p.name }))}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <div className="sm:col-span-2">
                  <LiveField
                    id={a.id}
                    field="locationOnSite"
                    label="Location on site"
                    initialValue={a.locationOnSite}
                    placeholder="Building / area / equipment label"
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </div>
              </div>
              <div className="mt-4">
                <LiveField
                  id={a.id}
                  field="jobScope"
                  initialValue={a.jobScope}
                  label="Job scope"
                  multiline
                  rows={4}
                  disabled={locked}
                  updateAction={updateTextField}
                  placeholder="Describe the work to be performed."
                />
              </div>
            </Section>
          </>
        </section>

        {showPPE ? (
          <section id="section-ppe" className="scroll-mt-2">
            <Section
              title={`Personal Protective Equipment (${ppe.length})`}
              defaultOpen
              icon={<Shield size={20} />}
              tone="blue"
            >
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
                  <p className="text-sm text-slate-500">No PPE rows.</p>
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
          </section>
        ) : null}

        {showQ ? (
          <section id="section-questions" className="scroll-mt-2">
            <Section
              title={`Questions & Answers (${questions.length})`}
              defaultOpen
              icon={<HelpCircle size={20} />}
              tone="purple"
            >
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
                  <p className="text-sm text-slate-500">No questions.</p>
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
          </section>
        ) : null}

        {showTasks ? (
          <section id="section-tasks" className="scroll-mt-2">
            <Section
              title={`Tasks (${tasks.length})`}
              defaultOpen
              icon={<ListChecks size={20} />}
              tone="teal"
            >
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
                  <p className="text-sm text-slate-500">No tasks.</p>
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
                        disabled={locked}
                        moveAction={moveTask}
                        deleteAction={deleteTask}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          </section>
        ) : null}

        {showHazards ? (
          <section id="section-hazards" className="scroll-mt-2">
            <Section
              title={`Hazards (${hazards.length})`}
              defaultOpen
              icon={<AlertTriangle size={20} />}
              tone="amber"
            >
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
                  <p className="text-sm text-slate-500">No hazards added.</p>
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
                        disabled={locked}
                        moveAction={moveHazard}
                        deleteAction={deleteHazard}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          </section>
        ) : null}

        {embeddedApps.length > 0 ? (
          <section id="section-apps" className="scroll-mt-2">
            <Section
              title={`Assessment apps (${embeddedApps.length})`}
              subtitle="Builder-powered specialty forms attached by this assessment type"
              defaultOpen
              icon={<LayoutGrid size={20} />}
              tone="indigo"
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {embeddedApps.map((item) => {
                  const status = item.status ?? 'not_started'
                  const statusVariant =
                    status === 'submitted' || status === 'closed'
                      ? ('success' as const)
                      : status === 'non_compliant' || status === 'rejected'
                        ? ('destructive' as const)
                        : status === 'draft' || status === 'in_progress'
                          ? ('warning' as const)
                          : ('secondary' as const)
                  const buttonLabel = item.done
                    ? 'View response'
                    : item.started
                      ? 'Continue'
                      : 'Start'
                  return (
                    <div
                      key={item.app.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <FileText size={16} className="text-teal-700 dark:text-teal-400" />
                            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                              {item.app.label}
                            </h3>
                            {item.app.required ? <Badge variant="outline">Required</Badge> : null}
                          </div>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                            {item.app.description ??
                              item.template.description ??
                              item.template.name}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <Badge variant={statusVariant}>{status.replace('_', ' ')}</Badge>
                            <span>{item.template.name}</span>
                            {item.response?.updatedAt ? (
                              <span>
                                Updated {new Date(item.response.updatedAt).toLocaleString()}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {item.done ? (
                          <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
                        ) : (
                          <PlayCircle size={18} className="shrink-0 text-slate-400" />
                        )}
                      </div>
                      <form action={openAssessmentApp} className="mt-4">
                        <input type="hidden" name="assessmentId" value={id} />
                        <input type="hidden" name="typeAppId" value={item.app.id} />
                        <Button
                          type="submit"
                          disabled={locked && !item.response}
                          className="ff-chip w-full sm:w-auto sm:min-w-32"
                        >
                          {item.done ? <CheckCircle2 size={16} /> : <PlayCircle size={16} />}
                          {buttonLabel}
                        </Button>
                      </form>
                    </div>
                  )
                })}
              </div>
            </Section>
          </section>
        ) : null}

        <section id="section-photos" className="scroll-mt-2">
          <Section
            title={`Photos & files (${photos.length})`}
            defaultOpen={photos.length > 0}
            icon={<Camera size={20} />}
            tone="slate"
          >
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
        </section>

        <section id="section-signatures" className="scroll-mt-2">
          <Section
            title={`Sign-off (${signatures.length})`}
            defaultOpen
            icon={<PenLine size={20} />}
            tone="emerald"
          >
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
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {signatures.map((s) => (
                    <li
                      key={s.row.id}
                      className="flex flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                            {s.person
                              ? `${s.person.firstName} ${s.person.lastName}`
                              : (s.row.externalName ?? 'Unknown')}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge
                              variant={s.row.signatureType === 'internal' ? 'secondary' : 'outline'}
                            >
                              {s.row.signatureType === 'internal' ? 'Employee' : 'External'}
                            </Badge>
                            {s.row.csEntrant ? <Badge variant="warning">Entrant</Badge> : null}
                            {s.row.csAttendant ? <Badge variant="warning">Attendant</Badge> : null}
                            {s.row.csRescue ? <Badge variant="destructive">Rescue</Badge> : null}
                          </div>
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
                      </div>
                      <div className="flex flex-1 items-center justify-center px-3 py-2">
                        {s.row.signatureDataUrl ? (
                          <img
                            src={s.row.signatureDataUrl}
                            alt="Signature"
                            className="h-16 max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-red-600">Not signed</span>
                        )}
                      </div>
                      <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-800">
                        {s.row.signedAt
                          ? `Signed ${new Date(s.row.signedAt).toLocaleString()}`
                          : 'Awaiting signature'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        </section>

        <section id="section-activity" className="scroll-mt-2">
          <Section
            title={`Activity (${activity.length})`}
            defaultOpen={false}
            icon={<History size={20} />}
            tone="slate"
          >
            <ActivityFeed entries={activity} />
          </Section>
        </section>
      </div>

      {/* Inline embedded-app fill — full-screen sheet over the assessment. */}
      {appFill ? (
        <div className="fixed inset-0 z-[60] bg-white dark:bg-slate-950">
          <FormRenderer
            templateId={appFill.templateId}
            templateName={appFill.templateName}
            version={appFill.version}
            schema={appFill.schema}
            sites={appFill.sites}
            people={appFill.people}
            entitiesByField={appFill.entitiesByField}
            currentUser={appFill.currentUser}
            initialResponseId={appFill.responseId}
            initialValues={appFill.initialValues}
            initialRows={appFill.initialRows}
            initialStepIndex={appFill.initialStepIndex}
            isResumed={appFill.resumeOk}
            returnTo={`/hazard-assessments/${id}#section-apps`}
          />
        </div>
      ) : null}

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
          showCSRoles={false}
          closeHref={tabHref}
          addAction={addSignature}
        />
      </UrlDrawer>

      {/* Delete confirmation */}
      <UrlDrawer
        open={drawerKey === 'confirm-delete'}
        closeHref={tabHref}
        title="Delete this assessment?"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
              {a.reference}
            </span>{' '}
            will be removed from every list and report. This is a soft delete — an administrator can
            recover it from the database if needed.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Link href={tabHref as any}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <form action={deleteAssessment}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" className="bg-red-600 text-white hover:bg-red-700">
                <Trash2 size={14} /> Delete assessment
              </Button>
            </form>
          </div>
        </div>
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
