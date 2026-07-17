import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  Textarea,
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
import { attachmentUrl } from '@/lib/attachment-url'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/lib/auth'
import { can } from '@beaconhs/tenant'
import { canSeeRecord } from '@/lib/visibility'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { FlowApprovals } from '@/components/flows/flow-approvals'
import { getPendingFlowGatesForSubject } from '@/lib/flows/gate-store'
import { canManageSubjectGates } from '@/lib/flows/registry'
import { canManageModule } from '@/lib/module-admin/guard'
import { recentActivityForEntity } from '@/lib/audit'
import { isUuid, pickString } from '@/lib/list-params'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { sendHazidEmail } from './_send-email'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { loadEntitiesForPickers } from '@/app/(app)/apps/_lib/entity-loader'
import {
  canAccessTemplate,
  canEditResponsePayload,
  templateAccessWhere,
} from '@/app/(app)/apps/_lib/access'
import { FormRenderer } from '@/app/(app)/apps/templates/[id]/fill/form-renderer'
import type { EntityAttrsByField, FormSchemaV1 } from '@beaconhs/forms-core'
import { PhotoGallery } from '@/components/photo-gallery'
import { PremiumSection as Section } from '@/components/premium-section'
import { hazidAppIsApplicable } from '@/lib/hazid-app-condition'
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
  reviewAssessment,
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
import {
  LiveDateTime,
  LiveField,
  LivePersonSelect,
  LiveRichText,
  LiveSelect,
} from '@/components/live-field'
import { datetimeLocalValue, formatDateTime } from '@/lib/datetime'
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
  if (!can(ctx, 'hazid.read.all') && !can(ctx, 'hazid.read.site') && !can(ctx, 'hazid.read.self')) {
    throw new Error('Not authorized')
  }
  const id = String(formData.get('id') ?? '')
  if (!id) return
  // Re-scope so a self/site-tier user can't email an assessment they can't see.
  const visible = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        reportedByTenantUserId: hazidAssessments.reportedByTenantUserId,
        siteOrgUnitId: hazidAssessments.siteOrgUnitId,
      })
      .from(hazidAssessments)
      .where(and(eq(hazidAssessments.id, id), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!row) return false
    return canSeeRecord(ctx, tx, {
      prefix: 'hazid',
      ownerIds: [row.reportedByTenantUserId],
      siteId: row.siteOrgUnitId,
    })
  })
  if (!visible) return
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
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  return { title: tGenerated('m_0a8975061b8522', { value0: id.slice(0, 8) }) }
}

export default async function HazidAssessmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const ctx = await requireRequestContext()
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)
  const pendingGates = await getPendingFlowGatesForSubject(
    ctx,
    'module',
    id,
    canManageSubjectGates(ctx, 'module', 'hazid'),
  )
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
      })
      .from(hazidAssessments)
      .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
      .leftJoin(
        hazidAssessmentTypes,
        eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
      )
      .where(and(eq(hazidAssessments.id, id), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!row) return null

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
    const allTypeApps = row.a.assessmentTypeId
      ? await tx
          .select({ app: hazidAssessmentTypeApps, template: formTemplates })
          .from(hazidAssessmentTypeApps)
          .innerJoin(formTemplates, eq(formTemplates.id, hazidAssessmentTypeApps.templateId))
          .where(
            and(
              eq(hazidAssessmentTypeApps.typeId, row.a.assessmentTypeId),
              isNull(hazidAssessmentTypeApps.deletedAt),
              templateAccessWhere(ctx, effectiveRoleKeys, 'browse-records'),
            ),
          )
          .orderBy(asc(hazidAssessmentTypeApps.entityOrder))
      : []
    const answersByTypeQuestionId = new Map(
      questions.flatMap((question) =>
        question.sourceTypeQuestionId
          ? [[question.sourceTypeQuestionId, question.answer] as const]
          : [],
      ),
    )
    const typeApps = allTypeApps.filter(({ app }) =>
      hazidAppIsApplicable(app.config, answersByTypeQuestionId),
    )
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
      // active sites only, plus this assessment's current site even if it was archived
      .where(
        and(
          eq(orgUnits.level, 'site'),
          or(
            isNull(orgUnits.deletedAt),
            row.a.siteOrgUnitId ? eq(orgUnits.id, row.a.siteOrgUnitId) : undefined,
          ),
        ),
      )
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
  // Per-user record visibility: read.all → any; read.site → my sites; else → ones
  // I reported.
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'hazid',
        ownerIds: [data.a.reportedByTenantUserId],
        siteId: data.a.siteOrgUnitId,
      }),
    ))
  )
    notFound()

  const {
    a,
    site,
    type,
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
  const canReview = can(ctx, 'hazid.review')
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
    const response = linked?.response ?? null
    const canOperateEmbeddedApp =
      typeApp &&
      response &&
      (response.status === 'draft' || response.status === 'in_progress') &&
      !a.locked &&
      canAccessTemplate(ctx, typeApp.template, effectiveRoleKeys, 'operate') &&
      canEditResponsePayload(ctx, response)
    if (typeApp && response && canOperateEmbeddedApp) {
      const loaded = await ctx.db(async (tx) => {
        const [version] = await tx
          .select()
          .from(formTemplateVersions)
          .where(
            and(
              eq(formTemplateVersions.id, response.templateVersionId),
              eq(formTemplateVersions.templateId, typeApp.app.templateId),
            ),
          )
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
        const resp = response
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
    url: attachmentUrl(p.attachment.id),
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
    const canOperate = canAccessTemplate(ctx, template, effectiveRoleKeys, 'operate')
    const canEdit = linked
      ? !done && canOperate && canEditResponsePayload(ctx, linked.response)
      : canOperate && can(ctx, 'forms.response.create')
    return {
      app,
      template,
      link: linked?.link ?? null,
      response: linked?.response ?? null,
      status,
      done,
      started,
      canEdit,
    }
  })
  const requiredEmbeddedApps = embeddedApps.filter((item) => item.app.required)
  const requiredEmbeddedDone = requiredEmbeddedApps.filter((item) => item.done).length

  const locked = a.locked
  const assessmentStyle = type?.style ?? 'task_based'
  const showPPE = type?.hasPPE ?? true
  const showQ = type?.hasQuestions ?? true
  const showTasks = assessmentStyle === 'task_based'
  const showHazards = assessmentStyle === 'hazard_based'
  const showJobScope = assessmentStyle === 'hazard_based'

  // ------------------------------------------------------------------
  // Readiness — how complete is this assessment? Drives the progress
  // strip on the Overview tab and the pre-lock warnings.
  // ------------------------------------------------------------------
  const ppeAnswered = ppe.filter((p) => p.answer != null).length
  const questionsAnswered = questions.filter((q) => (q.answer ?? '').trim().length > 0).length
  const requiresYesViolations = questions.filter(
    (q) => q.requiresYes && (q.answer ?? '').trim().length > 0 && q.answer?.toLowerCase() !== 'yes',
  )
  const tasksControlled = tasks.filter((t) => (t.row.controls ?? '').trim().length > 0).length
  const applicableHazards = hazards.filter((h) => h.row.applicable)
  const hazardsRated = applicableHazards.filter(
    (h) => h.row.preLikelihood != null && h.row.preSeverity != null,
  ).length
  const signedCount = signatures.filter((s) => s.row.signatureAttachmentId).length
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
  if (showTasks)
    readiness.push({
      label: 'Tasks controlled',
      done: tasksControlled,
      total: tasks.length,
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
    ...(showTasks
      ? [
          {
            id: 'tasks',
            label: 'Tasks',
            count: tasks.length,
            done: tasks.length > 0 && tasksControlled === tasks.length,
          },
        ]
      : []),
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
            title={tGeneratedValue(type?.name ?? tGenerated('m_171ca9d60eef14'))}
            subtitle={tGeneratedValue(
              `${a.reference} · ${formatDateTime(a.occurredAt, ctx.timezone, ctx.locale)}`,
            )}
            badge={
              <div className="flex items-center gap-2">
                <GeneratedValue
                  value={
                    locked ? (
                      <Badge variant="success">
                        <Lock size={10} /> <GeneratedText id="m_0e259fa0babc2d" />
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <GeneratedText id="m_1a03b06872ffd9" />
                      </Badge>
                    )
                  }
                />
                <Badge
                  variant={
                    a.reviewStatus === 'approved'
                      ? 'success'
                      : a.reviewStatus === 'rejected'
                        ? 'destructive'
                        : 'outline'
                  }
                >
                  <GeneratedText id="m_09dfacfcb5fc80" /> <GeneratedValue value={a.reviewStatus} />
                </Badge>
              </div>
            }
            actions={
              <AssessmentHeaderActions
                id={id}
                locked={locked}
                canManage={canManage}
                canReview={canReview}
                pdfHref={`/hazard-assessments/${id}/pdf`}
                emailHref={`/hazard-assessments/${id}?send=1`}
                reviewHref={drawerHref('safety-review')}
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
          <GeneratedValue
            value={
              locked ? (
                <Alert variant="warning">
                  <AlertTitle>
                    <GeneratedText id="m_17b55a364cc0d2" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedText id="m_110a9e28d94199" />{' '}
                    <GeneratedValue
                      value={
                        a.lockedAt ? formatDateTime(a.lockedAt, ctx.timezone, ctx.locale) : '—'
                      }
                    />
                    <GeneratedText id="m_15daaad329f55e" />
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
          <GeneratedValue
            value={
              requiresYesViolations.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>
                    <GeneratedValue value={requiresYesViolations.length} />{' '}
                    <GeneratedText id="m_115a5b98c7fe99" />
                    <GeneratedValue
                      value={
                        requiresYesViolations.length === 1 ? (
                          ''
                        ) : (
                          <GeneratedText id="m_00ded356f0f424" />
                        )
                      }
                    />{' '}
                    <GeneratedText id="m_1b243221c321ad" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedValue
                      value={requiresYesViolations
                        .map((q) => q.question)
                        .slice(0, 3)
                        .join(' · ')}
                    />
                    <GeneratedValue value={requiresYesViolations.length > 3 ? ' · …' : ''} />{' '}
                    <GeneratedText id="m_0950f40d4e262e" />
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
        </>
      }
      subtabs={<SectionNav sections={sectionItems} />}
    >
      <div className="ff-surface space-y-5">
        <GeneratedValue
          value={pendingGates.length > 0 ? <FlowApprovals gates={pendingGates} /> : null}
        />
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
                    <GeneratedValue value={overallPct} />%
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedValue value={overallDone} /> <GeneratedText id="m_00e704d1194796" />{' '}
                    <GeneratedValue value={overallTotal} /> <GeneratedText id="m_0562433d6260c9" />
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={type?.name ?? <GeneratedText id="m_171ca9d60eef14" />} />
                    <GeneratedValue value={site ? ` · ${site.name}` : ''} />
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <GeneratedText id="m_11db8e60406ba7" />
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
              <GeneratedValue
                value={readiness.map((r) => {
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
                          <GeneratedValue value={r.done} />
                          <span className="text-sm font-normal text-slate-400">
                            /<GeneratedValue value={r.total} />
                          </span>
                        </span>
                        <GeneratedValue
                          value={
                            complete ? (
                              <CheckCircle2 size={18} className="text-emerald-500" />
                            ) : (
                              <span className="text-xs font-medium text-slate-400">
                                <GeneratedValue value={pct} />%
                              </span>
                            )
                          }
                        />
                      </div>
                      <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <GeneratedValue value={r.label} />
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
              />
            </div>

            <Section
              title={tGenerated('m_062cdc4673a07a')}
              subtitle={tGenerated('m_1cf9885ac52ebd')}
              icon={<Building2 size={20} />}
              tone="slate"
            >
              {/* Live fields — the input on the page IS the field; everything
                  auto-saves, nothing hides behind an edit step. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LiveSelect
                  id={a.id}
                  field="assessmentTypeId"
                  label={tGenerated('m_169ce2294296b8')}
                  initialValue={a.assessmentTypeId}
                  options={typeOptions.map((t) => ({ value: t.id, label: t.name }))}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveDateTime
                  id={a.id}
                  field="occurredAt"
                  label={tGenerated('m_0abeba5c660f3f')}
                  initialValue={datetimeLocalValue(a.occurredAt, ctx.timezone)}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LivePersonSelect
                  id={a.id}
                  field="supervisorPersonId"
                  label={tGenerated('m_0ccb8e5b917b17')}
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
                  label={tGenerated('m_020146dd3d3d5a')}
                  initialValue={a.siteOrgUnitId}
                  options={siteOptions.map((s) => ({ value: s.id, label: s.name }))}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveSelect
                  id={a.id}
                  field="projectOrgUnitId"
                  label={tGenerated('m_05069b4b587da8')}
                  initialValue={a.projectOrgUnitId}
                  options={projectOptions.map((p) => ({ value: p.id, label: p.name }))}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <div className="sm:col-span-2">
                  <LiveField
                    id={a.id}
                    field="locationOnSite"
                    label={tGenerated('m_0300804afcc3bb')}
                    initialValue={a.locationOnSite}
                    placeholder={tGenerated('m_051443bf0b9acf')}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </div>
              </div>
              <GeneratedValue
                value={
                  showJobScope ? (
                    <div className="mt-4">
                      <LiveRichText
                        id={a.id}
                        field="jobScope"
                        initialValue={a.jobScope}
                        label={tGenerated('m_153980520c3722')}
                        disabled={locked}
                        updateAction={updateTextField}
                        placeholder={tGenerated('m_0cb8e069603f1e')}
                      />
                    </div>
                  ) : null
                }
              />
            </Section>
          </>
        </section>

        <GeneratedValue
          value={
            showPPE ? (
              <section id="section-ppe" className="scroll-mt-2">
                <Section
                  title={tGenerated('m_021b549e1aeb20', { value0: ppe.length })}
                  defaultOpen
                  icon={<Shield size={20} />}
                  tone="blue"
                >
                  <div className="space-y-3">
                    <GeneratedValue
                      value={
                        locked ? null : (
                          <div className="flex items-center justify-end">
                            <Link href={drawerHref('add-ppe') as any}>
                              <Button type="button" size="sm">
                                <Plus size={12} /> <GeneratedText id="m_0068c6e22ca766" />
                              </Button>
                            </Link>
                          </div>
                        )
                      }
                    />
                    <GeneratedValue
                      value={
                        ppe.length === 0 ? (
                          <p className="text-sm text-slate-500">
                            <GeneratedText id="m_1e34d5e60a3c81" />
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            <GeneratedValue
                              value={ppe.map((row, idx) => (
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
                            />
                          </ul>
                        )
                      }
                    />
                  </div>
                </Section>
              </section>
            ) : null
          }
        />

        <GeneratedValue
          value={
            showQ ? (
              <section id="section-questions" className="scroll-mt-2">
                <Section
                  title={tGenerated('m_07068dcbcbac3b', { value0: questions.length })}
                  defaultOpen
                  icon={<HelpCircle size={20} />}
                  tone="purple"
                >
                  <div className="space-y-3">
                    <GeneratedValue
                      value={
                        locked ? null : (
                          <div className="flex items-center justify-end">
                            <Link href={drawerHref('add-question') as any}>
                              <Button type="button" size="sm">
                                <Plus size={12} /> <GeneratedText id="m_029dffafbff34b" />
                              </Button>
                            </Link>
                          </div>
                        )
                      }
                    />
                    <GeneratedValue
                      value={
                        questions.length === 0 ? (
                          <p className="text-sm text-slate-500">
                            <GeneratedText id="m_18125ac5182332" />
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            <GeneratedValue
                              value={questions.map((row, idx) => (
                                <QuestionRow
                                  key={row.id}
                                  row={{
                                    ...row,
                                    questionType: row.questionType as
                                      'yes_no' | 'text' | 'multi_select',
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
                            />
                          </ul>
                        )
                      }
                    />
                  </div>
                </Section>
              </section>
            ) : null
          }
        />

        <GeneratedValue
          value={
            showTasks ? (
              <section id="section-tasks" className="scroll-mt-2">
                <Section
                  title={tGenerated('m_07a60b8f0641f7', { value0: tasks.length })}
                  defaultOpen
                  icon={<ListChecks size={20} />}
                  tone="teal"
                >
                  <div className="space-y-3">
                    <GeneratedValue
                      value={
                        locked ? null : (
                          <div className="flex items-center justify-end">
                            <Link href={drawerHref('add-task') as any}>
                              <Button type="button" size="sm">
                                <Plus size={12} /> <GeneratedText id="m_02ac1cf154a4f9" />
                              </Button>
                            </Link>
                          </div>
                        )
                      }
                    />
                    <GeneratedValue
                      value={
                        tasks.length === 0 ? (
                          <p className="text-sm text-slate-500">
                            <GeneratedText id="m_10d9a3e5d18bcf" />
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            <GeneratedValue
                              value={tasks.map((row, idx) => (
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
                            />
                          </ul>
                        )
                      }
                    />
                  </div>
                </Section>
              </section>
            ) : null
          }
        />

        <GeneratedValue
          value={
            showHazards ? (
              <section id="section-hazards" className="scroll-mt-2">
                <Section
                  title={tGenerated('m_134189340d1c67', { value0: hazards.length })}
                  defaultOpen
                  icon={<AlertTriangle size={20} />}
                  tone="amber"
                >
                  <div className="space-y-3">
                    <GeneratedValue
                      value={
                        locked ? null : (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Link href={drawerHref('add-hazard-library') as any}>
                              <Button type="button" size="sm" variant="outline">
                                <Plus size={12} /> <GeneratedText id="m_1ea86ac5ad7afa" />
                              </Button>
                            </Link>
                            <Link href={drawerHref('add-hazard-set') as any}>
                              <Button type="button" size="sm" variant="outline">
                                <Plus size={12} /> <GeneratedText id="m_130c47677645f8" />
                              </Button>
                            </Link>
                            <Link href={drawerHref('add-hazard') as any}>
                              <Button type="button" size="sm">
                                <Plus size={12} /> <GeneratedText id="m_1d0d917ac33140" />
                              </Button>
                            </Link>
                          </div>
                        )
                      }
                    />
                    <GeneratedValue
                      value={
                        hazards.length === 0 ? (
                          <p className="text-sm text-slate-500">
                            <GeneratedText id="m_018662f2277816" />
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            <GeneratedValue
                              value={hazards.map((row, idx) => (
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
                            />
                          </ul>
                        )
                      }
                    />
                  </div>
                </Section>
              </section>
            ) : null
          }
        />

        <GeneratedValue
          value={
            embeddedApps.length > 0 ? (
              <section id="section-apps" className="scroll-mt-2">
                <Section
                  title={tGenerated('m_0b9766d7cea491', { value0: embeddedApps.length })}
                  subtitle={tGenerated('m_01c24f55302970')}
                  defaultOpen
                  icon={<LayoutGrid size={20} />}
                  tone="indigo"
                >
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <GeneratedValue
                      value={embeddedApps.map((item) => {
                        const status = item.status ?? 'not_started'
                        const statusVariant =
                          status === 'submitted' || status === 'closed'
                            ? ('success' as const)
                            : status === 'non_compliant' || status === 'rejected'
                              ? ('destructive' as const)
                              : status === 'draft' || status === 'in_progress'
                                ? ('warning' as const)
                                : ('secondary' as const)
                        const buttonLabel = !item.canEdit
                          ? 'View response'
                          : item.done
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
                                  <FileText
                                    size={16}
                                    className="text-teal-700 dark:text-teal-400"
                                  />
                                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                                    <GeneratedValue value={item.app.label} />
                                  </h3>
                                  <GeneratedValue
                                    value={
                                      item.app.required ? (
                                        <Badge variant="outline">
                                          <GeneratedText id="m_12fe2fe7a9ddad" />
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                </div>
                                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                                  <GeneratedValue
                                    value={
                                      item.app.description ??
                                      item.template.description ??
                                      item.template.name
                                    }
                                  />
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                  <Badge variant={statusVariant}>
                                    <GeneratedValue value={status.replace('_', ' ')} />
                                  </Badge>
                                  <span>
                                    <GeneratedValue value={item.template.name} />
                                  </span>
                                  <GeneratedValue
                                    value={
                                      item.response?.updatedAt ? (
                                        <span>
                                          <GeneratedText id="m_014ca61c68ab13" />
                                          <GeneratedValue value={' '} />
                                          <GeneratedValue
                                            value={formatDateTime(
                                              item.response.updatedAt,
                                              ctx.timezone,
                                              ctx.locale,
                                            )}
                                          />
                                        </span>
                                      ) : null
                                    }
                                  />
                                </div>
                              </div>
                              <GeneratedValue
                                value={
                                  item.done ? (
                                    <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
                                  ) : (
                                    <PlayCircle size={18} className="shrink-0 text-slate-400" />
                                  )
                                }
                              />
                            </div>
                            <form action={openAssessmentApp} className="mt-4">
                              <input type="hidden" name="assessmentId" value={id} />
                              <input type="hidden" name="typeAppId" value={item.app.id} />
                              <Button
                                type="submit"
                                // Locked assessments are read-only: submitted responses
                                // stay viewable, drafts cannot be continued or started.
                                disabled={!item.done && (locked || !item.canEdit)}
                                className="ff-chip w-full sm:w-auto sm:min-w-32"
                              >
                                <GeneratedValue
                                  value={
                                    item.done ? (
                                      <CheckCircle2 size={16} />
                                    ) : (
                                      <PlayCircle size={16} />
                                    )
                                  }
                                />
                                <GeneratedValue value={buttonLabel} />
                              </Button>
                            </form>
                          </div>
                        )
                      })}
                    />
                  </div>
                </Section>
              </section>
            ) : null
          }
        />

        <section id="section-photos" className="scroll-mt-2">
          <Section
            title={tGenerated('m_11939da4a6a866', { value0: photos.length })}
            defaultOpen={photos.length > 0}
            icon={<Camera size={20} />}
            tone="slate"
          >
            <div className="space-y-3">
              <PhotoGallery photos={galleryPhotos} />
              <GeneratedValue
                value={
                  !locked ? (
                    <HazidPhotoUploader assessmentId={id} attachAction={attachPhotos} />
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  !locked && photos.length > 0 ? (
                    <ul className="space-y-1 text-xs text-slate-500">
                      <GeneratedValue
                        value={photos.map((p) => (
                          <li key={p.link.id} className="flex items-center justify-between">
                            <span>
                              <GeneratedValue value={p.attachment.filename} />
                            </span>
                            <form action={deletePhoto}>
                              <input type="hidden" name="id" value={p.link.id} />
                              <input type="hidden" name="assessmentId" value={id} />
                              <button type="submit" className="text-red-600 hover:underline">
                                <GeneratedText id="m_1a9d8d971b1edb" />
                              </button>
                            </form>
                          </li>
                        ))}
                      />
                    </ul>
                  ) : null
                }
              />
            </div>
          </Section>
        </section>

        <section id="section-signatures" className="scroll-mt-2">
          <Section
            title={tGenerated('m_0a21ba9b825206', { value0: signatures.length })}
            defaultOpen
            icon={<PenLine size={20} />}
            tone="emerald"
          >
            <div className="space-y-3">
              <GeneratedValue
                value={
                  locked ? null : (
                    <div className="flex items-center justify-end">
                      <Link href={drawerHref('add-signature') as any}>
                        <Button type="button" size="sm">
                          <Plus size={12} /> <GeneratedText id="m_173c1ae83a1c73" />
                        </Button>
                      </Link>
                    </div>
                  )
                }
              />
              <GeneratedValue
                value={
                  signatures.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      <GeneratedText id="m_120e5b08a8be3b" />
                    </p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <GeneratedValue
                        value={signatures.map((s) => (
                          <li
                            key={s.row.id}
                            className="flex flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                              <div className="min-w-0">
                                <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                                  <GeneratedValue
                                    value={
                                      s.person
                                        ? `${s.person.firstName} ${s.person.lastName}`
                                        : (s.row.externalName ?? (
                                            <GeneratedText id="m_0514b7f2fb419d" />
                                          ))
                                    }
                                  />
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  <Badge
                                    variant={
                                      s.row.signatureType === 'internal' ? 'secondary' : 'outline'
                                    }
                                  >
                                    <GeneratedValue
                                      value={
                                        s.row.signatureType === 'internal' ? (
                                          <GeneratedText id="m_0d191facfeeb70" />
                                        ) : (
                                          <GeneratedText id="m_0899166c3156c0" />
                                        )
                                      }
                                    />
                                  </Badge>
                                  <GeneratedValue
                                    value={
                                      s.row.csEntrant ? (
                                        <Badge variant="warning">
                                          <GeneratedText id="m_022b05599a1a05" />
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                  <GeneratedValue
                                    value={
                                      s.row.csAttendant ? (
                                        <Badge variant="warning">
                                          <GeneratedText id="m_0d8bbd3094ef27" />
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                  <GeneratedValue
                                    value={
                                      s.row.csRescue ? (
                                        <Badge variant="destructive">
                                          <GeneratedText id="m_1bac787ac2b6fc" />
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                </div>
                              </div>
                              <GeneratedValue
                                value={
                                  !locked ? (
                                    <form action={deleteSignature}>
                                      <input type="hidden" name="id" value={s.row.id} />
                                      <input type="hidden" name="assessmentId" value={id} />
                                      <Button type="submit" size="sm" variant="ghost">
                                        <GeneratedText id="m_11773f3c3f7558" />
                                      </Button>
                                    </form>
                                  ) : null
                                }
                              />
                            </div>
                            <div className="flex flex-1 items-center justify-center px-3 py-2">
                              <GeneratedValue
                                value={
                                  s.row.signatureAttachmentId ? (
                                    <Image
                                      src={attachmentUrl(s.row.signatureAttachmentId)}
                                      alt={tGenerated('m_0c0bc02db58371')}
                                      width={320}
                                      height={64}
                                      unoptimized
                                      className="h-16 w-auto max-w-full object-contain"
                                    />
                                  ) : (
                                    <span className="text-xs text-red-600">
                                      <GeneratedText id="m_17f941df9401b5" />
                                    </span>
                                  )
                                }
                              />
                            </div>
                            <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-800">
                              <GeneratedValue
                                value={
                                  s.row.signedAt ? (
                                    <GeneratedText
                                      id="m_06fc9c8c2b8b14"
                                      values={{
                                        value0: formatDateTime(
                                          s.row.signedAt,
                                          ctx.timezone,
                                          ctx.locale,
                                        ),
                                      }}
                                    />
                                  ) : (
                                    <GeneratedText id="m_1386967e45366b" />
                                  )
                                }
                              />
                            </div>
                          </li>
                        ))}
                      />
                    </ul>
                  )
                }
              />
            </div>
          </Section>
        </section>

        <section id="section-activity" className="scroll-mt-2">
          <Section
            title={tGenerated('m_158532c8e94ad5', { value0: activity.length })}
            defaultOpen={false}
            icon={<History size={20} />}
            tone="slate"
          >
            <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
          </Section>
        </section>
      </div>

      {/* Inline embedded-app fill — full-screen sheet over the assessment. */}
      <GeneratedValue
        value={
          appFill ? (
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
          ) : null
        }
      />

      {/* ============================================================== */}
      {/* Drawers — one per drawer key. Each is `open` only when the URL */}
      {/* `?drawer=` matches AND the row lookup (if any) succeeded.      */}
      {/* ============================================================== */}

      {/* Tasks */}
      <UrlDrawer
        open={drawerKey === 'add-task'}
        closeHref={tabHref}
        title={tGenerated('m_02ac1cf154a4f9')}
        description={tGenerated('m_1c7529d48ef5db')}
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
        title={tGenerated('m_106407c29478a2')}
        size="md"
      >
        <GeneratedValue
          value={
            editTaskRow ? (
              <EditTaskDrawerBody
                assessmentId={id}
                closeHref={tabHref}
                row={editTaskRow.row}
                taskName={editTaskRow.task?.name ?? null}
                hazardLookup={hazardNameLookup}
                updateAction={updateTask}
              />
            ) : null
          }
        />
      </UrlDrawer>

      {/* Hazards */}
      <UrlDrawer
        open={drawerKey === 'add-hazard-library'}
        closeHref={tabHref}
        title={tGenerated('m_19272e778b78be')}
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
        title={tGenerated('m_1ab7f9d61bbc3c')}
        description={tGenerated('m_01b23816efeafe')}
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
        title={tGenerated('m_1524c1cf6ac205')}
        size="md"
      >
        <AddHazardDrawerBody assessmentId={id} closeHref={tabHref} addAction={addHazard} />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'edit-hazard' && !!editHazardRow}
        closeHref={tabHref}
        title={tGenerated('m_1e7cc4ca81f651')}
        size="md"
      >
        <GeneratedValue
          value={
            editHazardRow ? (
              <EditHazardDrawerBody
                assessmentId={id}
                closeHref={tabHref}
                row={editHazardRow.row}
                libraryName={editHazardRow.library?.name ?? null}
                updateAction={updateHazard}
              />
            ) : null
          }
        />
      </UrlDrawer>

      {/* PPE */}
      <UrlDrawer
        open={drawerKey === 'add-ppe'}
        closeHref={tabHref}
        title={tGenerated('m_0068c6e22ca766')}
        size="md"
      >
        <AddPPEDrawerBody assessmentId={id} closeHref={tabHref} addAction={addPPE} />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'edit-ppe' && !!editPPERow}
        closeHref={tabHref}
        title={tGenerated('m_17041530e210ee')}
        size="md"
      >
        <GeneratedValue
          value={
            editPPERow ? (
              <EditPPEDrawerBody
                assessmentId={id}
                closeHref={tabHref}
                row={editPPERow}
                updateAction={updatePPE}
              />
            ) : null
          }
        />
      </UrlDrawer>

      {/* Questions */}
      <UrlDrawer
        open={drawerKey === 'add-question'}
        closeHref={tabHref}
        title={tGenerated('m_029dffafbff34b')}
        size="md"
      >
        <AddQuestionDrawerBody assessmentId={id} closeHref={tabHref} addAction={addQuestion} />
      </UrlDrawer>
      <UrlDrawer
        open={drawerKey === 'edit-question' && !!editQuestionRow}
        closeHref={tabHref}
        title={tGenerated('m_06b6a61fd2d8b0')}
        size="md"
      >
        <GeneratedValue
          value={
            editQuestionRow ? (
              <EditQuestionDrawerBody
                assessmentId={id}
                closeHref={tabHref}
                row={{
                  ...editQuestionRow,
                  questionType: editQuestionRow.questionType as 'yes_no' | 'text' | 'multi_select',
                }}
                updateAction={updateQuestion}
              />
            ) : null
          }
        />
      </UrlDrawer>

      {/* Signatures */}
      <UrlDrawer
        open={drawerKey === 'add-signature'}
        closeHref={tabHref}
        title={tGenerated('m_173c1ae83a1c73')}
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

      {/* Safety review — visible and actionable only with the dedicated review permission. */}
      <UrlDrawer
        open={drawerKey === 'safety-review' && canReview}
        closeHref={tabHref}
        title={tGenerated('m_039fc01243fb46')}
        description={tGenerated('m_1dcf53db730123')}
        size="md"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge
              variant={
                a.reviewStatus === 'approved'
                  ? 'success'
                  : a.reviewStatus === 'rejected'
                    ? 'destructive'
                    : 'outline'
              }
            >
              <GeneratedValue value={a.reviewStatus} />
            </Badge>
            <GeneratedValue
              value={
                a.reviewedAt ? (
                  <span className="text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_08791cd0d5daff" />{' '}
                    <GeneratedValue
                      value={formatDateTime(a.reviewedAt, ctx.timezone, ctx.locale)}
                    />
                  </span>
                ) : null
              }
            />
          </div>
          <GeneratedValue
            value={
              a.reviewNote ? (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <GeneratedValue value={a.reviewNote} />
                </p>
              ) : null
            }
          />
          <form action={reviewAssessment} className="space-y-3">
            <input type="hidden" name="id" value={id} />
            <Textarea
              name="note"
              rows={3}
              defaultValue={a.reviewNote ?? ''}
              placeholder={tGenerated('m_0f5bae5cd10511')}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="decision" value="approved">
                <GeneratedText id="m_05194a49d7f46e" />
              </Button>
              <Button type="submit" name="decision" value="rejected" variant="destructive">
                <GeneratedText id="m_0f51548c04b27f" />
              </Button>
            </div>
          </form>
        </div>
      </UrlDrawer>

      {/* Delete confirmation — module managers only, matching deleteAssessment */}
      <UrlDrawer
        open={drawerKey === 'confirm-delete' && canManage}
        closeHref={tabHref}
        title={tGenerated('m_0203e50a2675bb')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
              <GeneratedValue value={a.reference} />
            </span>
            <GeneratedValue value={' '} />
            <GeneratedText id="m_1a4a84621ce774" />
          </p>
          <div className="flex items-center justify-end gap-2">
            <Link href={tabHref as any}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <form action={deleteAssessment}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" className="bg-red-600 text-white hover:bg-red-700">
                <Trash2 size={14} /> <GeneratedText id="m_0045f44b1d8771" />
              </Button>
            </form>
          </div>
        </div>
      </UrlDrawer>

      <GenericSendEmailDialog
        open={pickString(sp.send) === '1'}
        title={tGenerated('m_1798459ce7b554')}
        description={tGenerated('m_1347794b396886')}
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
