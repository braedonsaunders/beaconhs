// /ppe/[id] — per-item detail with sub-tabs.
//
// Tabs:
//   overview     → DetailGrid of the item's metadata
//   inspections  → list of past inspections + a criteria-driven form that pulls
//                  from ppe_type_inspection_criteria for the item's type
//   annual       → list of ppe_annual_records (third-party recertifications)
//                  + add-form with certificate upload pointer
//   issues       → defective-PPE issue reports (open / resolved)
//   history      → issue / return / replace ledger
//   status       → status mutator with holder picker when switching to 'issued'
//
// All mutations recordAudit. Failing pre-use inspections with severity ≥ high
// auto-spawn a CA via spawnCorrectiveActionForFailedPpeInspection().

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq } from 'drizzle-orm'
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'
import {
  attachments,
  correctiveActions,
  people,
  ppeAnnualRecords,
  ppeInspections,
  ppeIssueReports,
  ppeIssues,
  ppeItems,
  ppeTypeInspectionCriteria,
  ppeTypes,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { PersonSelectField } from '@/components/person-select-field'
import { LiveField, LiveSelect } from '@/components/live-field'
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section'
import { recordAudit } from '@/lib/audit'
import { CertificateDrawer, type CertificateInput } from './_certificate-drawer'
import { PpeInspectionForm } from './_inspection-form'
import { pickString } from '@/lib/list-params'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { sendPpeIssueEmail } from './_send-email'
import {
  daysUntil,
  deriveAnnualYear,
  loadInspectionCriteriaForType,
  recordPpeIssueAction,
  shouldSpawnCorrectiveAction,
  spawnCorrectiveActionForFailedPpeInspection,
} from '../_lib'

export const dynamic = 'force-dynamic'

const PPE_TABS = ['overview', 'inspections', 'annual', 'issues', 'history'] as const
type PpeTab = (typeof PPE_TABS)[number]

// --- Server actions -----------------------------------------------------

// Inline auto-save for the unified edit/view Overview. Mirrors the incidents
// `updateTextField` whitelist pattern: only user-owned identity fields are
// editable here — lifecycle (status/holder) and derived schedule dates stay
// read-only and are maintained by the issuance / inspection actions.
async function updatePpeField(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  if (!can(ctx, 'ppe.manage')) throw new Error('You do not have permission to manage PPE')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const TEXT = new Set(['serialNumber', 'size', 'notes'])
  const DATE_ONLY = new Set(['purchaseDate', 'expiresOn'])
  const FK_REQUIRED = new Set(['typeId'])
  if (!TEXT.has(field) && !DATE_ONLY.has(field) && !FK_REQUIRED.has(field)) {
    throw new Error('Field not allowed')
  }

  let val: unknown
  if (DATE_ONLY.has(field)) {
    val = value || null
  } else if (FK_REQUIRED.has(field)) {
    if (!value) throw new Error('This field is required')
    val = value
  } else {
    const trimmed = value.trim()
    val = trimmed === '' ? null : value
  }

  await ctx.db((tx) =>
    tx
      .update(ppeItems)
      .set({ [field]: val } as any)
      .where(eq(ppeItems.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_item',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: { [field]: val },
  })
  revalidatePath(`/ppe/${id}`)
  revalidatePath('/ppe')
}

async function recordInspection(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.inspect')
  const itemId = String(formData.get('itemId') ?? '')
  const typeId = String(formData.get('typeId') ?? '')
  const kind = String(formData.get('kind') ?? 'pre_use') as 'pre_use' | 'annual'
  const notes = String(formData.get('notes') ?? '').trim() || null
  const today = new Date().toISOString().slice(0, 10)

  // Pull the criteria list so we can validate the per-row answers + compute
  // whether any fail is high+ severity (drives the auto-CA). The overall result
  // is DERIVED from the answers — there is no manual override.
  const criteria = await loadInspectionCriteriaForType(ctx, typeId, kind)
  let highestSeverityFailQuestion: { question: string; severity: 'high' | 'critical' } | null = null
  let anyFail = false
  for (const c of criteria) {
    const raw = String(formData.get(`criterion_${c.id}`) ?? '')
    // Every criterion must be answered (the client enforces this too).
    if (raw !== 'pass' && raw !== 'fail' && raw !== 'n_a') {
      throw new Error('Answer every criterion before recording the inspection')
    }
    if (raw === 'fail') {
      anyFail = true
      if (
        shouldSpawnCorrectiveAction(raw, c.severity) &&
        (!highestSeverityFailQuestion ||
          c.severity === 'critical' ||
          highestSeverityFailQuestion.severity === 'high')
      ) {
        highestSeverityFailQuestion = {
          question: c.question,
          severity: c.severity as 'high' | 'critical',
        }
      }
    }
  }
  // Derived result: any failed criterion fails the inspection; otherwise it
  // passes (an all-N/A checklist counts as a pass — nothing was found wrong).
  const finalResult: 'pass' | 'fail' = anyFail ? 'fail' : 'pass'

  const inspectionId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(ppeInspections)
      .values({
        tenantId: ctx.tenantId,
        itemId,
        kind,
        result: finalResult,
        inspectedOn: today,
        nextDueOn: nextDueDate(kind, today),
        notes,
        inspectedByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: ppeInspections.id })
    const set =
      kind === 'pre_use'
        ? { lastInspectionOn: today, nextInspectionDue: nextDueDate(kind, today) }
        : { lastAnnualInspectionOn: today, nextAnnualInspectionDue: nextDueDate(kind, today) }
    await tx.update(ppeItems).set(set).where(eq(ppeItems.id, itemId))
    return row?.id ?? null
  })

  await recordAudit(ctx, {
    entityType: 'ppe_inspection',
    entityId: inspectionId ?? undefined,
    action: 'create',
    summary: `Recorded ${kind === 'pre_use' ? 'pre-use' : 'annual'} inspection — ${finalResult}`,
    after: { itemId, kind, result: finalResult, criteriaFailed: anyFail },
  })

  // Auto-spawn a CA when the inspection fails on a high+ severity criterion.
  if (inspectionId && highestSeverityFailQuestion) {
    await spawnCorrectiveActionForFailedPpeInspection(ctx, {
      inspectionId,
      itemId,
      title: `PPE inspection finding: ${highestSeverityFailQuestion.question.slice(0, 80)}`,
      description: [
        `PPE item ${itemId} failed a ${kind === 'pre_use' ? 'pre-use' : 'annual'} inspection.`,
        `Failing criterion: "${highestSeverityFailQuestion.question}"`,
        notes ? `Inspector notes: ${notes}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      severity: highestSeverityFailQuestion.severity,
    })
  }

  revalidatePath(`/ppe/${itemId}`)
  redirect(`/ppe/${itemId}?tab=inspections`)
}

async function setStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '')
  const status = String(formData.get('status') ?? '') as
    | 'in_stock'
    | 'issued'
    | 'returned'
    | 'damaged'
    | 'discarded'
    | 'expired'
  const personId = String(formData.get('personId') ?? '').trim() || null
  const note = String(formData.get('note') ?? '').trim() || null

  // Permission split mirrors the transition: issuing needs issue, returning needs
  // return, everything else (damage/discard/in-stock/expire) is a manage write.
  if (status === 'issued') assertCan(ctx, 'ppe.issue')
  else if (status === 'returned') assertCan(ctx, 'ppe.return')
  else assertCan(ctx, 'ppe.manage')

  if (status === 'issued') {
    if (!personId) return
    await recordPpeIssueAction(ctx, { itemId, personId, action: 'issue', note })
  } else if (status === 'returned') {
    await recordPpeIssueAction(ctx, { itemId, personId: null, action: 'return', note })
  } else if (status === 'damaged') {
    await recordPpeIssueAction(ctx, { itemId, personId: null, action: 'mark_damaged', note })
  } else if (status === 'discarded') {
    await recordPpeIssueAction(ctx, { itemId, personId: null, action: 'discard', note })
  } else {
    // 'in_stock' / 'expired' — no ledger row, just flip the flag.
    await ctx.db((tx) => tx.update(ppeItems).set({ status }).where(eq(ppeItems.id, itemId)))
    await recordAudit(ctx, {
      entityType: 'ppe_item',
      entityId: itemId,
      action: 'update',
      summary: `Set PPE status → ${status}`,
      after: { status },
    })
  }
  revalidatePath(`/ppe/${itemId}`)
  revalidatePath('/ppe')
  redirect(`/ppe/${itemId}?tab=overview`)
}

async function reportIssue(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.inspect')
  const itemId = String(formData.get('itemId') ?? '')
  const description = String(formData.get('description') ?? '').trim()
  if (!description) return
  const reportId = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(ppeIssueReports)
      .values({
        tenantId: ctx.tenantId,
        itemId,
        description,
        status: 'open',
        reportedByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: ppeIssueReports.id })
    return r?.id ?? null
  })
  await recordAudit(ctx, {
    entityType: 'ppe_issue_report',
    entityId: reportId ?? undefined,
    action: 'create',
    summary: 'Reported PPE defect',
    after: { itemId, description },
  })
  revalidatePath(`/ppe/${itemId}`)
  redirect(`/ppe/${itemId}?tab=issues`)
}

async function resolveIssue(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.manage')
  const id = String(formData.get('id') ?? '').trim()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const resolution = String(formData.get('resolution') ?? '').trim() || null
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(ppeIssueReports)
      .set({ status: 'resolved', resolution, resolvedAt: new Date() })
      .where(eq(ppeIssueReports.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_issue_report',
    entityId: id,
    action: 'update',
    summary: 'Resolved PPE defect report',
    after: { resolution },
  })
  revalidatePath(`/ppe/${itemId}`)
}

// Save a third-party recertification certificate. Object-arg (not FormData) so
// the client drawer can upload the file first, then hand us the attachment id.
// Returns {ok} so the drawer can surface validation/permission errors inline.
async function addCertificate(
  input: CertificateInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  if (!can(ctx, 'ppe.manage')) {
    return { ok: false, error: 'You do not have permission to manage PPE.' }
  }
  const itemId = input.itemId.trim()
  const inspectedOn = input.inspectedOn.trim()
  if (!itemId || !inspectedOn) return { ok: false, error: 'Inspection date is required.' }
  const result: 'pass' | 'fail' | 'remediated' = ['pass', 'fail', 'remediated'].includes(
    input.result,
  )
    ? input.result
    : 'pass'
  const year = deriveAnnualYear(inspectedOn)
  const nextDueOn = (() => {
    const d = new Date(inspectedOn)
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })()
  let id: string | null = null
  try {
    id = await ctx.db(async (tx) => {
      const [row] = await tx
        .insert(ppeAnnualRecords)
        .values({
          tenantId: ctx.tenantId,
          itemId,
          year,
          inspectedOn,
          nextDueOn,
          inspectedByPersonId: input.inspectedByPersonId,
          inspectorName: input.inspectorName,
          inspectorCompany: input.inspectorCompany,
          certificateAttachmentId: input.certificateAttachmentId,
          result,
          notes: input.notes,
        })
        .returning({ id: ppeAnnualRecords.id })
      // Cache the new annual dates on the item for the reports.
      await tx
        .update(ppeItems)
        .set({ lastAnnualInspectionOn: inspectedOn, nextAnnualInspectionDue: nextDueOn })
        .where(eq(ppeItems.id, itemId))
      return row?.id ?? null
    })
  } catch {
    return { ok: false, error: `A certificate for ${year} already exists on this item.` }
  }
  await recordAudit(ctx, {
    entityType: 'ppe_annual_record',
    entityId: id ?? undefined,
    action: 'create',
    summary: `Certificate recorded — ${result}`,
    after: {
      itemId,
      year,
      inspectedOn,
      result,
      certificateAttachmentId: input.certificateAttachmentId,
    },
  })
  revalidatePath(`/ppe/${itemId}`)
  return { ok: true }
}

async function deleteCertificate(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  if (!can(ctx, 'ppe.manage')) throw new Error('You do not have permission to manage PPE')
  const recordId = String(formData.get('id') ?? '').trim()
  const itemId = String(formData.get('itemId') ?? '').trim()
  if (!recordId || !itemId) return
  await ctx.db((tx) =>
    tx
      .delete(ppeAnnualRecords)
      .where(and(eq(ppeAnnualRecords.id, recordId), eq(ppeAnnualRecords.itemId, itemId))),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_annual_record',
    entityId: recordId,
    action: 'delete',
    summary: 'Deleted certificate',
    before: { itemId },
  })
  revalidatePath(`/ppe/${itemId}`)
}

// Inline server action for the Send-email dialog. Allows shipping an
// open issue report (or the item summary when no issue is open) to a
// maintenance distribution list or any explicit recipients.
async function sendEmailAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.read.all')
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
  await sendPpeIssueEmail(ctx, id, {
    recipients: recipients.length > 0 ? recipients : undefined,
    cc: cc.length > 0 ? cc : undefined,
    subjectPrefix,
    messageOverride,
  })
  revalidatePath(`/ppe/${id}`)
}

function nextDueDate(kind: 'pre_use' | 'annual', iso: string): string {
  const d = new Date(iso)
  if (kind === 'annual') d.setFullYear(d.getFullYear() + 1)
  else d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `PPE · ${id.slice(0, 8)}` }
}

export default async function PpeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(eq(ppeItems.id, id))
      .limit(1)
    if (!row) return null

    const [inspections, issuesLog, issueReports, annualRecords, peopleList, relatedCAs] =
      await Promise.all([
        tx
          .select({
            insp: ppeInspections,
            insp_by: people,
          })
          .from(ppeInspections)
          .leftJoin(people, eq(people.id, ppeInspections.inspectedByTenantUserId))
          .where(eq(ppeInspections.itemId, id))
          .orderBy(desc(ppeInspections.inspectedOn)),
        tx
          .select({ issue: ppeIssues, person: people })
          .from(ppeIssues)
          .leftJoin(people, eq(people.id, ppeIssues.personId))
          .where(eq(ppeIssues.itemId, id))
          .orderBy(desc(ppeIssues.occurredAt)),
        tx
          .select()
          .from(ppeIssueReports)
          .where(eq(ppeIssueReports.itemId, id))
          .orderBy(desc(ppeIssueReports.reportedAt)),
        tx
          .select({
            rec: ppeAnnualRecords,
            person: people,
            cert: attachments,
          })
          .from(ppeAnnualRecords)
          .leftJoin(people, eq(people.id, ppeAnnualRecords.inspectedByPersonId))
          .leftJoin(attachments, eq(attachments.id, ppeAnnualRecords.certificateAttachmentId))
          .where(eq(ppeAnnualRecords.itemId, id))
          .orderBy(desc(ppeAnnualRecords.inspectedOn)),
        tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            employeeNo: people.employeeNo,
          })
          .from(people)
          .where(eq(people.status, 'active'))
          .orderBy(asc(people.lastName), asc(people.firstName))
          .limit(500),
        tx
          .select()
          .from(correctiveActions)
          .where(
            and(
              eq(correctiveActions.sourceEntityType, 'ppe_inspection'),
              // matches any inspection row that belongs to this item; we filter
              // client-side because the inspection ids set is small
            ),
          )
          .limit(50),
      ])

    // The inspection flyout is launched per-kind, so we load both lists and
    // hand the drawer only the one matching the clicked button.
    const preUseCriteria = await loadInspectionCriteriaForType(ctx, row.type.id, 'pre_use')
    const annualCriteria = await loadInspectionCriteriaForType(ctx, row.type.id, 'annual')

    // All PPE types for the Type select on the editable Overview.
    const typesList = await tx
      .select({ id: ppeTypes.id, name: ppeTypes.name })
      .from(ppeTypes)
      .orderBy(asc(ppeTypes.name))

    // Cross-reference CAs back to this item's inspections so we can show them
    // in the inspection list.
    const inspectionIds = new Set(inspections.map((i) => i.insp.id))
    const itemCAs = relatedCAs.filter(
      (ca) => ca.sourceEntityId && inspectionIds.has(ca.sourceEntityId),
    )

    return {
      ...row,
      inspections,
      issuesLog,
      issueReports,
      annualRecords,
      peopleList,
      typesList,
      preUseCriteria,
      annualCriteria,
      itemCAs,
    }
  })

  if (!data) notFound()
  const {
    item,
    type,
    holder,
    inspections,
    issuesLog,
    issueReports,
    annualRecords,
    peopleList,
    typesList,
    preUseCriteria,
    annualCriteria,
    itemCAs,
  } = data
  const openIssues = issueReports.filter((r) => r.status === 'open')
  const expiringIn = daysUntil(item.expiresOn)
  const inspectionDueIn = daysUntil(item.nextInspectionDue)
  const annualDueIn = daysUntil(item.nextAnnualInspectionDue)
  // Editing the register-level fields requires the Manage PPE permission;
  // everyone else gets a read-only view of the same page.
  const canManage = can(ctx, 'ppe.manage')
  // Custody actions live in the header so they are always reachable. Issuing
  // needs the issue permission; the status change covers returns/damage/discard
  // and is available to anyone who can return or manage PPE.
  const canIssue = can(ctx, 'ppe.issue')
  const canChangeStatus = can(ctx, 'ppe.return') || canManage

  // The inspection flyout is opened per-kind from the Pre-use / Annual buttons,
  // so render only the criteria for the launched kind (they are separate
  // inspection types and must not be mixed in one form).
  const inspectionKind: 'pre_use' | 'annual' =
    pickString(sp.kind) === 'annual' ? 'annual' : 'pre_use'
  const inspectionCriteria = inspectionKind === 'annual' ? annualCriteria : preUseCriteria

  const peopleOptions = peopleList.map((p) => ({
    value: p.id,
    label: `${p.lastName}, ${p.firstName}`,
    hint: p.employeeNo ?? undefined,
  }))

  // Tab visibility is driven by the PPE type's configuration:
  //   • Inspections — shown only when the type has a pre-use and/or annual
  //     checklist (the criteria themselves are the "requires inspection" signal).
  //   • Certificates — shown when the type is flagged as requiring third-party
  //     recertification (configurable on the type), or it already has records.
  const hasPreUse = preUseCriteria.length > 0
  const hasAnnual = annualCriteria.length > 0
  const hasInspections = hasPreUse || hasAnnual
  const requiresCertificate = type.inspectionSchedule?.requiresCertificate ?? false
  const showCertificates = requiresCertificate || annualRecords.length > 0

  const visibleTabs: PpeTab[] = [
    'overview',
    ...(hasInspections ? (['inspections'] as const) : []),
    ...(showCertificates ? (['annual'] as const) : []),
    'issues',
    'history',
  ]
  // Fall back to Overview when a now-hidden tab is requested via the URL.
  const active: PpeTab = pickActiveTab(sp, visibleTabs, 'overview')

  const basePath = `/ppe/${id}`
  // Drawer state is URL-driven; preserve the active tab in the close URL so
  // that closing the drawer doesn't kick you back to Overview.
  const drawerKey = pickString(sp.drawer)
  const closeHref = `${basePath}?tab=${active}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/ppe', label: 'Back to PPE' }}
          title={`${type.name} · ${item.serialNumber ?? 'no serial'}`}
          subtitle={`Size ${item.size ?? '—'} · ${type.category ?? ''}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  item.status === 'issued'
                    ? 'success'
                    : item.status === 'in_stock'
                      ? 'secondary'
                      : 'warning'
                }
              >
                {item.status.replace('_', ' ')}
              </Badge>
              {openIssues.length > 0 ? (
                <Badge variant="destructive">
                  {openIssues.length} open issue{openIssues.length === 1 ? '' : 's'}
                </Badge>
              ) : null}
              {expiringIn !== null && expiringIn <= 30 ? (
                <Badge variant={expiringIn < 0 ? 'destructive' : 'warning'}>
                  {expiringIn < 0 ? `Expired ${-expiringIn}d` : `Expires in ${expiringIn}d`}
                </Badge>
              ) : null}
            </div>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canIssue ? (
                <Link
                  href={`${basePath}?tab=${active}&drawer=issue-to-person` as any}
                  scroll={false}
                >
                  <Button>
                    <UserPlus size={14} /> Issue to person
                  </Button>
                </Link>
              ) : null}
              {canChangeStatus ? (
                <Link href={`${basePath}?tab=${active}&drawer=change-status` as any} scroll={false}>
                  <Button variant="outline">
                    <RefreshCw size={14} /> Change status
                  </Button>
                </Link>
              ) : null}
              <Link
                href={`/ppe/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any}
                scroll={false}
              >
                <Button variant="outline">
                  <Mail size={14} /> Send email
                </Button>
              </Link>
            </div>
          }
        />
      }
      alerts={
        <>
          {openIssues.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Open issue report</AlertTitle>
              <AlertDescription>{openIssues[0]!.description}</AlertDescription>
            </Alert>
          ) : null}
          {hasInspections && inspectionDueIn !== null && inspectionDueIn <= 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Inspection overdue</AlertTitle>
              <AlertDescription>
                The pre-use inspection was due on {item.nextInspectionDue}. Record a new one from
                the Inspections tab.
              </AlertDescription>
            </Alert>
          ) : null}
          {showCertificates && annualDueIn !== null && annualDueIn <= 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Certificate overdue</AlertTitle>
              <AlertDescription>
                The third-party recertification was due on {item.nextAnnualInspectionDue}.
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          variant="pills"
          tabs={[
            { key: 'overview', label: 'Overview' },
            ...(hasInspections
              ? [{ key: 'inspections', label: 'Inspections', count: inspections.length }]
              : []),
            ...(showCertificates
              ? [{ key: 'annual', label: 'Certificates', count: annualRecords.length }]
              : []),
            { key: 'issues', label: 'Issues', count: issueReports.length },
            { key: 'history', label: 'History', count: issuesLog.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <div className="space-y-5">
            <Section
              title="Details"
              subtitle={
                canManage
                  ? 'Changes save automatically.'
                  : 'Read-only — editing requires the Manage PPE permission.'
              }
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LiveSelect
                  id={id}
                  field="typeId"
                  label="Type"
                  initialValue={type.id}
                  options={typesList.map((t) => ({ value: t.id, label: t.name }))}
                  allowEmpty={false}
                  disabled={!canManage}
                  updateAction={updatePpeField}
                />
                <LiveField
                  id={id}
                  field="serialNumber"
                  label="Serial #"
                  initialValue={item.serialNumber}
                  placeholder="Serial number"
                  disabled={!canManage}
                  updateAction={updatePpeField}
                />
                <LiveField
                  id={id}
                  field="size"
                  label="Size"
                  initialValue={item.size}
                  placeholder="e.g. L"
                  disabled={!canManage}
                  updateAction={updatePpeField}
                />
                <LiveField
                  id={id}
                  field="purchaseDate"
                  label="Purchased"
                  type="date"
                  initialValue={item.purchaseDate}
                  disabled={!canManage}
                  updateAction={updatePpeField}
                />
                <LiveField
                  id={id}
                  field="expiresOn"
                  label="Expires"
                  type="date"
                  initialValue={item.expiresOn}
                  disabled={!canManage}
                  updateAction={updatePpeField}
                />
              </div>
              <div className="mt-4">
                <LiveField
                  id={id}
                  field="notes"
                  label="Notes"
                  multiline
                  rows={3}
                  initialValue={item.notes}
                  placeholder="Anything noteworthy about this item"
                  disabled={!canManage}
                  updateAction={updatePpeField}
                />
              </div>
            </Section>

            <Section
              title="Status & schedule"
              subtitle="Maintained automatically by issuance, inspection, and certificate records."
            >
              <DetailGrid
                rows={[
                  {
                    label: 'Status',
                    value: (
                      <Badge
                        variant={
                          item.status === 'issued'
                            ? 'success'
                            : item.status === 'in_stock'
                              ? 'secondary'
                              : 'warning'
                        }
                      >
                        {item.status.replace('_', ' ')}
                      </Badge>
                    ),
                  },
                  {
                    label: 'Currently with',
                    value: holder ? (
                      <Link href={`/people/${holder.id}`} className="text-teal-700 hover:underline">
                        {holder.firstName} {holder.lastName}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  {
                    label: 'Expires',
                    value: item.expiresOn ? (
                      <span
                        className={
                          expiringIn !== null && expiringIn < 0
                            ? 'text-red-700'
                            : expiringIn !== null && expiringIn <= 30
                              ? 'text-amber-700'
                              : ''
                        }
                      >
                        {item.expiresOn}
                        {expiringIn !== null
                          ? ` (${expiringIn < 0 ? `${-expiringIn}d overdue` : `${expiringIn}d`})`
                          : ''}
                      </span>
                    ) : (
                      '—'
                    ),
                  },
                  ...(hasInspections
                    ? [
                        { label: 'Last inspection', value: item.lastInspectionOn ?? '—' },
                        {
                          label: 'Next inspection due',
                          value: item.nextInspectionDue ? (
                            <span
                              className={
                                inspectionDueIn !== null && inspectionDueIn < 0
                                  ? 'text-red-700'
                                  : ''
                              }
                            >
                              {item.nextInspectionDue}
                            </span>
                          ) : (
                            '—'
                          ),
                        },
                      ]
                    : []),
                  ...(showCertificates
                    ? [
                        { label: 'Last certificate', value: item.lastAnnualInspectionOn ?? '—' },
                        {
                          label: 'Next certificate due',
                          value: item.nextAnnualInspectionDue ? (
                            <span
                              className={
                                annualDueIn !== null && annualDueIn < 0 ? 'text-red-700' : ''
                              }
                            >
                              {item.nextAnnualInspectionDue}
                            </span>
                          ) : (
                            '—'
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </Section>

            <CustomFieldsSection
              ctx={ctx}
              entityKind="ppe"
              recordId={item.id}
              subtypeId={item.typeId}
              metadata={item.metadata}
              locked={!canManage}
            />
          </div>
        ) : null}

        {active === 'inspections' ? (
          <>
            <Section
              title={`Inspections (${inspections.length})`}
              actions={
                <div className="flex items-center gap-2">
                  {hasPreUse ? (
                    <Link
                      href={
                        `${basePath}?tab=inspections&drawer=record-inspection&kind=pre_use` as any
                      }
                    >
                      <Button size="sm">
                        <ClipboardCheck size={14} /> Pre-use
                      </Button>
                    </Link>
                  ) : null}
                  {hasAnnual ? (
                    <Link
                      href={
                        `${basePath}?tab=inspections&drawer=record-inspection&kind=annual` as any
                      }
                    >
                      <Button size="sm" variant={hasPreUse ? 'outline' : 'default'}>
                        <ShieldCheck size={14} /> Annual
                      </Button>
                    </Link>
                  ) : null}
                </div>
              }
            >
              {inspections.length === 0 ? (
                <EmptyState
                  icon={<ClipboardCheck size={24} />}
                  title="No inspections recorded"
                  action={
                    <Link
                      href={
                        `${basePath}?tab=inspections&drawer=record-inspection&kind=${hasPreUse ? 'pre_use' : 'annual'}` as any
                      }
                    >
                      <Button size="sm" variant="outline">
                        <ClipboardCheck size={14} /> Record {hasPreUse ? 'pre-use' : 'annual'}{' '}
                        inspection
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Next due</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>CA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inspections.map((row) => {
                      const ca = itemCAs.find((c) => c.sourceEntityId === row.insp.id)
                      return (
                        <TableRow key={row.insp.id}>
                          <TableCell>{row.insp.inspectedOn}</TableCell>
                          <TableCell>{row.insp.kind.replace('_', ' ')}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                row.insp.result === 'pass'
                                  ? 'success'
                                  : row.insp.result === 'fail'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                            >
                              {row.insp.result.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>{row.insp.nextDueOn ?? '—'}</TableCell>
                          <TableCell className="text-slate-600">{row.insp.notes ?? '—'}</TableCell>
                          <TableCell>
                            {ca ? (
                              <Link
                                href={`/corrective-actions/${ca.id}`}
                                className="text-teal-700 hover:underline"
                              >
                                {ca.reference}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </Section>
          </>
        ) : null}

        {active === 'annual' ? (
          <Section
            title={`Certificates (${annualRecords.length})`}
            subtitle="Third-party recertification certificates (e.g. annual harness or fall-arrest inspections)."
            actions={
              canManage ? (
                <Link href={`${basePath}?tab=annual&drawer=add-certificate` as any}>
                  <Button size="sm">
                    <Plus size={14} /> Add certificate
                  </Button>
                </Link>
              ) : null
            }
          >
            {annualRecords.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck size={24} />}
                title="No certificates yet"
                description="Upload the most recent third-party recertification to start the history."
                action={
                  canManage ? (
                    <Link href={`${basePath}?tab=annual&drawer=add-certificate` as any}>
                      <Button size="sm" variant="outline">
                        <Plus size={14} /> Add the first certificate
                      </Button>
                    </Link>
                  ) : null
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Inspector</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Next due</TableHead>
                    <TableHead>Certificate</TableHead>
                    <TableHead>Notes</TableHead>
                    {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {annualRecords.map(({ rec, person, cert }) => (
                    <TableRow key={rec.id}>
                      <TableCell className="font-mono">{rec.year}</TableCell>
                      <TableCell>{rec.inspectedOn}</TableCell>
                      <TableCell>
                        {person
                          ? `${person.firstName} ${person.lastName}`
                          : rec.inspectorName
                            ? `${rec.inspectorName}${rec.inspectorCompany ? ` (${rec.inspectorCompany})` : ''}`
                            : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            rec.result === 'pass'
                              ? 'success'
                              : rec.result === 'fail'
                                ? 'destructive'
                                : 'warning'
                          }
                        >
                          {rec.result}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">{rec.nextDueOn ?? '—'}</TableCell>
                      <TableCell>
                        {cert ? (
                          <a
                            href={publicUrl(cert.r2Key)}
                            className="inline-flex items-center gap-1.5 text-teal-700 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileText size={13} /> {cert.filename}
                          </a>
                        ) : (
                          <span className="text-slate-400">No file</span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">{rec.notes ?? '—'}</TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <form action={deleteCertificate} className="inline">
                            <input type="hidden" name="id" value={rec.id} />
                            <input type="hidden" name="itemId" value={id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="ghost"
                              aria-label="Delete certificate"
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </Button>
                          </form>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        ) : null}

        {active === 'issues' ? (
          <Section
            title={`Defect reports (${issueReports.length})`}
            actions={
              <Link href={`${basePath}?tab=issues&drawer=report-issue` as any}>
                <Button size="sm" variant="destructive">
                  <AlertTriangle size={14} /> Report defect
                </Button>
              </Link>
            }
          >
            {issueReports.length === 0 ? (
              <EmptyState
                icon={<AlertTriangle size={24} />}
                title="No defects reported"
                description="Report a defect when an item is damaged, contaminated, or fails inspection."
                action={
                  <Link href={`${basePath}?tab=issues&drawer=report-issue` as any}>
                    <Button size="sm" variant="outline">
                      <AlertTriangle size={14} /> Report defect
                    </Button>
                  </Link>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reported</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Resolution</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issueReports.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.reportedAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-slate-700">{r.description}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'open' ? 'destructive' : 'success'}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">{r.resolution ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {r.status === 'open' ? (
                            <form action={resolveIssue} className="flex items-center gap-1.5">
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="itemId" value={id} />
                              <Input
                                name="resolution"
                                placeholder="Resolution…"
                                className="h-8 w-40"
                              />
                              <Button type="submit" size="sm">
                                Resolve
                              </Button>
                            </form>
                          ) : null}
                          <Link
                            href={`/ppe/${id}/issues/${r.id}/pdf` as any}
                            target="_blank"
                            className="text-xs text-teal-700 hover:underline"
                          >
                            PDF
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        ) : null}

        {active === 'history' ? (
          <Section title={`Issue / return / replace log (${issuesLog.length})`}>
            {issuesLog.length === 0 ? (
              <p className="text-sm text-slate-500">No issuance history.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issuesLog.map((row) => (
                    <TableRow key={row.issue.id}>
                      <TableCell>{new Date(row.issue.occurredAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.issue.action === 'issue'
                              ? 'success'
                              : row.issue.action === 'discard' ||
                                  row.issue.action === 'mark_damaged'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {row.issue.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.person ? (
                          <Link
                            href={`/people/${row.person.id}`}
                            className="text-teal-700 hover:underline"
                          >
                            {row.person.firstName} {row.person.lastName}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">{row.issue.note ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        ) : null}
      </div>

      <GenericSendEmailDialog
        open={pickString(sp.send) === '1'}
        title={openIssues.length > 0 ? 'Send PPE issue report' : 'Send PPE item summary'}
        description={
          openIssues.length > 0
            ? 'Emails the most-recent open defect report (item summary + the report details) to the addresses you enter below.'
            : 'Emails a summary of this PPE item (type, serial, status, holder, size, expiry) to the addresses you enter below.'
        }
        recipientsHint="Enter at least one recipient — each gets their own copy. Nothing is sent if this is left blank."
        reference={item.serialNumber ?? id.slice(0, 8)}
        defaultSubjectPrefix={openIssues.length > 0 ? 'Action required' : 'FYI'}
        sendAction={async (fd) => {
          'use server'
          fd.set('id', id)
          await sendEmailAction(fd)
        }}
      />

      {/*
       * Sub-entity drawers. Mounted once per page; only one is open at a time
       * (URL-driven via `?drawer=…`). Each form inside the drawer has an id
       * so the sticky footer's submit button can target it via the `form`
       * attribute. Closing pops back to closeHref which preserves the
       * active tab.
       */}
      <UrlDrawer
        open={drawerKey === 'record-inspection'}
        closeHref={closeHref}
        title={
          inspectionKind === 'annual' ? 'Record annual inspection' : 'Record pre-use inspection'
        }
        description={
          inspectionKind === 'annual'
            ? 'Answer every annual criterion. The result is derived from the answers; high+ severity failures auto-spawn a corrective action.'
            : 'Answer every pre-use criterion. The result is derived from the answers; high+ severity failures auto-spawn a corrective action.'
        }
        size="lg"
      >
        <PpeInspectionForm
          itemId={id}
          typeId={type.id}
          kind={inspectionKind}
          criteria={inspectionCriteria}
          action={recordInspection}
        />
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'report-issue'}
        closeHref={closeHref}
        title="Report defect"
        description="Logs a defect report against this PPE item. Open reports surface on the dashboard and the item header."
        size="md"
        footer={
          <Button type="submit" form="ppe-report-issue-form" variant="destructive">
            <AlertTriangle size={14} /> Report defect
          </Button>
        }
      >
        <form id="ppe-report-issue-form" action={reportIssue} className="space-y-3">
          <input type="hidden" name="itemId" value={id} />
          <div className="space-y-1.5">
            <Label>What's wrong? *</Label>
            <Textarea
              name="description"
              rows={6}
              required
              placeholder="Frayed strap, missing buckle, damage from drop, contamination, etc."
            />
          </div>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'issue-to-person'}
        closeHref={closeHref}
        title="Issue to person"
        description="Hand this item to a named holder and append an issuance row to the ledger."
        size="md"
        footer={
          <Button type="submit" form="ppe-issue-to-person-form">
            <UserPlus size={14} /> Issue
          </Button>
        }
      >
        <form id="ppe-issue-to-person-form" action={setStatus} className="space-y-3">
          <input type="hidden" name="itemId" value={id} />
          <input type="hidden" name="status" value="issued" />
          <div className="space-y-1.5">
            <Label>Holder *</Label>
            <PersonSelectField
              name="personId"
              defaultValue={item.currentHolderPersonId ?? ''}
              options={peopleList.map((p) => ({
                value: p.id,
                label: `${p.lastName}, ${p.firstName}`,
                hint: p.employeeNo ?? undefined,
              }))}
              placeholder="Pick a person…"
              clearable={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea
              name="note"
              rows={3}
              placeholder="Optional context for the issuance ledger entry"
            />
          </div>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'change-status'}
        closeHref={closeHref}
        title="Change status"
        description="Mark this item as returned, damaged, discarded, in stock, or expired. Issuing to a person uses the dedicated drawer."
        size="md"
        footer={
          <Button type="submit" form="ppe-change-status-form">
            <RefreshCw size={14} /> Update status
          </Button>
        }
      >
        <form id="ppe-change-status-form" action={setStatus} className="space-y-3">
          <input type="hidden" name="itemId" value={id} />
          <div className="space-y-1.5">
            <Label>New status</Label>
            <Select
              name="status"
              defaultValue={item.status === 'issued' ? 'returned' : item.status}
            >
              <option value="returned">Returned</option>
              <option value="in_stock">In stock</option>
              <option value="damaged">Damaged</option>
              <option value="discarded">Discarded</option>
              <option value="expired">Expired</option>
            </Select>
            <p className="text-xs text-slate-500">
              To issue to a person, use the Issue to person action instead.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea
              name="note"
              rows={3}
              placeholder="Optional ledger note for this status change"
            />
          </div>
        </form>
      </UrlDrawer>

      <CertificateDrawer
        open={drawerKey === 'add-certificate'}
        closeHref={closeHref}
        itemId={id}
        peopleOptions={peopleOptions}
        todayIso={new Date().toISOString().slice(0, 10)}
        saveAction={async (input: CertificateInput) => {
          'use server'
          return addCertificate({ ...input, itemId: id })
        }}
      />
    </DetailPageLayout>
  )
}
