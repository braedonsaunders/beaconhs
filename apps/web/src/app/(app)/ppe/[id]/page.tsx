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
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq } from 'drizzle-orm'
import { Camera, ClipboardCheck, HardHat, Mail, Plus, ShieldCheck } from 'lucide-react'
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
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
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

const PPE_TABS = ['overview', 'inspections', 'annual', 'issues', 'history', 'status'] as const
type PpeTab = (typeof PPE_TABS)[number]

// --- Server actions -----------------------------------------------------

async function recordInspection(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '')
  const typeId = String(formData.get('typeId') ?? '')
  const kind = String(formData.get('kind') ?? 'pre_use') as 'pre_use' | 'annual'
  const overallResult = String(formData.get('result') ?? 'pass') as 'pass' | 'fail' | 'n_a'
  const notes = String(formData.get('notes') ?? '').trim() || null
  const today = new Date().toISOString().slice(0, 10)

  // Pull the criteria list so we can validate the per-row answers + compute
  // whether any fail is high+ severity (drives the auto-CA).
  const criteria = await loadInspectionCriteriaForType(ctx, typeId, kind)
  let highestSeverityFailQuestion: { question: string; severity: 'high' | 'critical' } | null = null
  let anyFail = false
  for (const c of criteria) {
    const answer = String(formData.get(`criterion_${c.id}`) ?? 'n_a') as
      | 'pass'
      | 'fail'
      | 'n_a'
    if (answer === 'fail') {
      anyFail = true
      if (
        shouldSpawnCorrectiveAction(answer, c.severity) &&
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
  // The form-level "Result" is a manual override that becomes the row's
  // canonical result; if any per-criterion fail was logged we force it to
  // fail so the data stays consistent.
  const finalResult: 'pass' | 'fail' | 'n_a' = anyFail ? 'fail' : overallResult

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
}

async function reportIssue(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
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
}

async function resolveIssue(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
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

async function addAnnualRecord(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const inspectedOn = String(formData.get('inspectedOn') ?? '').trim()
  const inspectedByPersonId = String(formData.get('inspectedByPersonId') ?? '').trim() || null
  const inspectorName = String(formData.get('inspectorName') ?? '').trim() || null
  const inspectorCompany = String(formData.get('inspectorCompany') ?? '').trim() || null
  const certificateAttachmentId =
    String(formData.get('certificateAttachmentId') ?? '').trim() || null
  const result = String(formData.get('result') ?? 'pass') as 'pass' | 'fail' | 'remediated'
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!itemId || !inspectedOn) return
  const year = deriveAnnualYear(inspectedOn)
  const nextDueOn = (() => {
    const d = new Date(inspectedOn)
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })()
  const id = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(ppeAnnualRecords)
      .values({
        tenantId: ctx.tenantId,
        itemId,
        year,
        inspectedOn,
        nextDueOn,
        inspectedByPersonId,
        inspectorName,
        inspectorCompany,
        certificateAttachmentId,
        result,
        notes,
      })
      .returning({ id: ppeAnnualRecords.id })
    // Cache the new annual dates on the item for the reports.
    await tx
      .update(ppeItems)
      .set({ lastAnnualInspectionOn: inspectedOn, nextAnnualInspectionDue: nextDueOn })
      .where(eq(ppeItems.id, itemId))
    return row?.id ?? null
  })
  await recordAudit(ctx, {
    entityType: 'ppe_annual_record',
    entityId: id ?? undefined,
    action: 'create',
    summary: `Annual recertification recorded — ${result}`,
    after: {
      itemId,
      year,
      inspectedOn,
      result,
      certificateAttachmentId,
    },
  })
  revalidatePath(`/ppe/${itemId}`)
}

// Inline server action for the Send-email dialog. Allows shipping an
// open issue report (or the item summary when no issue is open) to a
// maintenance distribution list or any explicit recipients.
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
  const active: PpeTab = pickActiveTab(sp, PPE_TABS, 'overview')
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

    const [
      inspections,
      issuesLog,
      issueReports,
      annualRecords,
      peopleList,
      relatedCAs,
    ] = await Promise.all([
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
        .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
        .from(people)
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

    // Pre-load the criteria for the next inspection form (we render two
    // toggles — one for pre_use, one for annual; default pre_use).
    const preUseCriteria = await loadInspectionCriteriaForType(ctx, row.type.id, 'pre_use')
    const annualCriteria = await loadInspectionCriteriaForType(ctx, row.type.id, 'annual')

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
    preUseCriteria,
    annualCriteria,
    itemCAs,
  } = data
  const openIssues = issueReports.filter((r) => r.status === 'open')
  const expiringIn = daysUntil(item.expiresOn)
  const inspectionDueIn = daysUntil(item.nextInspectionDue)
  const annualDueIn = daysUntil(item.nextAnnualInspectionDue)

  const basePath = `/ppe/${id}`
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
            <Link
              href={`/ppe/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any}
              scroll={false}
            >
              <Button variant="outline">
                <Mail size={14} /> Send email
              </Button>
            </Link>
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
          {inspectionDueIn !== null && inspectionDueIn <= 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Inspection overdue</AlertTitle>
              <AlertDescription>
                The pre-use inspection was due on {item.nextInspectionDue}. Record a new
                one from the Inspections tab.
              </AlertDescription>
            </Alert>
          ) : null}
          {annualDueIn !== null && annualDueIn <= 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Annual recertification overdue</AlertTitle>
              <AlertDescription>
                The annual third-party recertification was due on {item.nextAnnualInspectionDue}.
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
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'inspections', label: 'Inspections', count: inspections.length },
            { key: 'annual', label: 'Annual records', count: annualRecords.length },
            { key: 'issues', label: 'Issues', count: issueReports.length },
            { key: 'history', label: 'History', count: issuesLog.length },
            { key: 'status', label: 'Status' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <Section title="General">
            <DetailGrid
              rows={[
                { label: 'Type', value: <Link href={`/ppe/types/${type.id}`} className="text-teal-700 hover:underline">{type.name}</Link> },
                { label: 'Serial #', value: item.serialNumber ?? '—' },
                { label: 'Size', value: item.size ?? '—' },
                {
                  label: 'Currently with',
                  value: holder ? (
                    <Link
                      href={`/people/${holder.id}`}
                      className="text-teal-700 hover:underline"
                    >
                      {holder.firstName} {holder.lastName}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Purchased', value: item.purchaseDate ?? '—' },
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
                { label: 'Last annual', value: item.lastAnnualInspectionOn ?? '—' },
                {
                  label: 'Next annual due',
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
                { label: 'Notes', value: item.notes ?? '—' },
              ]}
            />
          </Section>
        ) : null}

        {active === 'inspections' ? (
          <>
            <Section title={`Inspections (${inspections.length})`}>
              {inspections.length === 0 ? (
                <EmptyState icon={<ClipboardCheck size={24} />} title="No inspections recorded" />
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
                          <TableCell className="text-slate-600">
                            {row.insp.notes ?? '—'}
                          </TableCell>
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

            <Section title="Record new inspection" subtitle="Walks through the criteria configured on this PPE type.">
              <CriteriaInspectionForm
                itemId={id}
                typeId={type.id}
                preUseCriteria={preUseCriteria}
                annualCriteria={annualCriteria}
                action={recordInspection}
              />
            </Section>
          </>
        ) : null}

        {active === 'annual' ? (
          <>
            <Section title={`Annual records (${annualRecords.length})`}>
              {annualRecords.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck size={24} />}
                  title="No annual records yet"
                  description="Upload the most recent third-party recertification to start the history."
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
                              href={`/api/attachments/${cert.id}`}
                              className="text-teal-700 hover:underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {cert.filename}
                            </a>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-slate-600">{rec.notes ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>

            <Section title="Add annual record" subtitle="Capture the third-party inspector's signed certificate.">
              <form action={addAnnualRecord} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input type="hidden" name="itemId" value={id} />
                <div className="space-y-1.5">
                  <Label>Inspected on *</Label>
                  <Input type="date" name="inspectedOn" required />
                </div>
                <div className="space-y-1.5">
                  <Label>Result *</Label>
                  <Select name="result" defaultValue="pass">
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    <option value="remediated">Pass after remediation</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Inspected by (person)</Label>
                  <Select name="inspectedByPersonId" defaultValue="">
                    <option value="">— External inspector —</option>
                    {peopleList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lastName}, {p.firstName}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Inspector name (free-text)</Label>
                  <Input name="inspectorName" placeholder="e.g. Joe Rigger" />
                </div>
                <div className="space-y-1.5">
                  <Label>Inspector company</Label>
                  <Input name="inspectorCompany" placeholder="e.g. Acme Riggers Ltd" />
                </div>
                <div className="space-y-1.5">
                  <Label>Certificate attachment ID</Label>
                  <Input
                    name="certificateAttachmentId"
                    placeholder="UUID from /api/attachments"
                  />
                  <p className="text-xs text-slate-500">
                    Upload via the file uploader elsewhere then paste the attachment id here.
                  </p>
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>Notes</Label>
                  <Textarea name="notes" rows={2} />
                </div>
                <div className="sm:col-span-3 flex justify-end">
                  <Button type="submit">
                    <Plus size={14} /> Save annual record
                  </Button>
                </div>
              </form>
            </Section>
          </>
        ) : null}

        {active === 'issues' ? (
          <Section title={`Defect reports (${issueReports.length})`}>
            {issueReports.length === 0 ? (
              <p className="text-sm text-slate-500">No issues reported.</p>
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
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/50 p-4">
              <h4 className="mb-2 text-sm font-semibold">Report a new defect</h4>
              <form action={reportIssue} className="space-y-2">
                <input type="hidden" name="itemId" value={id} />
                <Textarea
                  name="description"
                  rows={2}
                  placeholder="Frayed strap, missing buckle, damage from drop, etc."
                  required
                />
                <Button type="submit" variant="destructive">
                  Report defect
                </Button>
              </form>
            </div>
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
                      <TableCell>
                        {new Date(row.issue.occurredAt).toLocaleDateString()}
                      </TableCell>
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

        {active === 'status' ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-slate-500">
                Changing status to <strong>issued</strong> prompts for a holder and inserts a
                ledger row. Changing to <strong>returned</strong> clears the holder. The other
                statuses behave like simple state flips.
              </p>
              <form action={setStatus} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input type="hidden" name="itemId" value={id} />
                <div className="space-y-1.5">
                  <Label>Set status</Label>
                  <Select name="status" defaultValue={item.status}>
                    {['in_stock', 'issued', 'returned', 'damaged', 'discarded', 'expired'].map(
                      (s) => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ')}
                        </option>
                      ),
                    )}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Holder (required when issuing)</Label>
                  <Select name="personId" defaultValue={item.currentHolderPersonId ?? ''}>
                    <option value="">— None —</option>
                    {peopleList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lastName}, {p.firstName}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Note</Label>
                  <Input name="note" placeholder="Optional ledger note for this status change" />
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <Button type="submit">Update status</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <GenericSendEmailDialog
        open={pickString(sp.send) === '1'}
        title={openIssues.length > 0 ? 'Send PPE issue report' : 'Send PPE item summary'}
        description={
          openIssues.length > 0
            ? 'Sends the most-recent open issue report to maintenance. Recipients default to the tenant admin distribution list when blank.'
            : 'Sends a PPE item summary. Recipients default to the tenant admin distribution list when blank.'
        }
        reference={item.serialNumber ?? id.slice(0, 8)}
        defaultSubjectPrefix={openIssues.length > 0 ? 'Action required' : 'FYI'}
        sendAction={async (fd) => {
          'use server'
          fd.set('id', id)
          await sendEmailAction(fd)
        }}
      />
    </DetailPageLayout>
  )
}

function CriteriaInspectionForm({
  itemId,
  typeId,
  preUseCriteria,
  annualCriteria,
  action,
}: {
  itemId: string
  typeId: string
  preUseCriteria: {
    id: string
    question: string
    description: string | null
    severity: 'low' | 'medium' | 'high' | 'critical'
    requiresPhoto: boolean
  }[]
  annualCriteria: {
    id: string
    question: string
    description: string | null
    severity: 'low' | 'medium' | 'high' | 'critical'
    requiresPhoto: boolean
  }[]
  action: (fd: FormData) => Promise<void>
}) {
  // The form ships both lists; the user picks kind in the Select. We render
  // both critera lists in <details> so the form stays tight by default.
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="typeId" value={typeId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Kind</Label>
          <Select name="kind" defaultValue="pre_use">
            <option value="pre_use">Pre-use</option>
            <option value="annual">Annual</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Manual overall result</Label>
          <Select name="result" defaultValue="pass">
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="n_a">N/A</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input name="notes" placeholder="Anything to flag overall?" />
        </div>
      </div>

      {preUseCriteria.length > 0 ? (
        <details open className="rounded-md border border-slate-200 bg-slate-50/50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Pre-use criteria ({preUseCriteria.length}) — answer per criterion. High+ failures
            auto-spawn a corrective action.
          </summary>
          <ul className="mt-3 space-y-2">
            {preUseCriteria.map((c, i) => (
              <CriterionRow key={c.id} index={i} criterion={c} />
            ))}
          </ul>
        </details>
      ) : null}

      {annualCriteria.length > 0 ? (
        <details className="rounded-md border border-slate-200 bg-slate-50/50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Annual criteria ({annualCriteria.length}) — answer when recording an annual.
          </summary>
          <ul className="mt-3 space-y-2">
            {annualCriteria.map((c, i) => (
              <CriterionRow key={c.id} index={i} criterion={c} />
            ))}
          </ul>
        </details>
      ) : null}

      {preUseCriteria.length === 0 && annualCriteria.length === 0 ? (
        <Alert>
          <AlertTitle>No criteria configured on this PPE type yet</AlertTitle>
          <AlertDescription>
            Go to{' '}
            <Link
              href={`/ppe/types/${typeId}?tab=inspection-criteria`}
              className="text-teal-700 hover:underline"
            >
              the type detail page
            </Link>{' '}
            and add criteria — they'll show up here automatically.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit">
          <HardHat size={14} /> Record inspection
        </Button>
      </div>
    </form>
  )
}

function CriterionRow({
  index,
  criterion,
}: {
  index: number
  criterion: {
    id: string
    question: string
    description: string | null
    severity: 'low' | 'medium' | 'high' | 'critical'
    requiresPhoto: boolean
  }
}) {
  return (
    <li className="rounded border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <span className="text-slate-500">{index + 1}.</span>
            {criterion.question}
            {criterion.requiresPhoto ? (
              <Badge variant="warning">
                <Camera size={10} /> photo
              </Badge>
            ) : null}
            <Badge
              variant={
                criterion.severity === 'critical' || criterion.severity === 'high'
                  ? 'destructive'
                  : criterion.severity === 'medium'
                    ? 'warning'
                    : 'secondary'
              }
            >
              {criterion.severity}
            </Badge>
          </div>
          {criterion.description ? (
            <p className="mt-1 text-xs text-slate-500">{criterion.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs">
          {(['pass', 'fail', 'n_a'] as const).map((v) => (
            <label
              key={v}
              className="flex cursor-pointer items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1"
            >
              <input
                type="radio"
                name={`criterion_${criterion.id}`}
                value={v}
                defaultChecked={v === 'n_a'}
              />
              {v === 'n_a' ? 'N/A' : v.charAt(0).toUpperCase() + v.slice(1)}
            </label>
          ))}
        </div>
      </div>
    </li>
  )
}
