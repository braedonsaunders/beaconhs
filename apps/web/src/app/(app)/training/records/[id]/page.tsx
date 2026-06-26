import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, isNull, like } from 'drizzle-orm'
import {
  CreditCard,
  FileText,
  Paperclip,
  Printer,
  RotateCcw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldX,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  attachments,
  people,
  tenants,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { CredentialDownloadButton } from '@/components/credential-download-button'
import { ConfirmButton } from '@/components/confirm-button'
import { StatTile, type StatTone } from '@/components/stat-tile'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { isUuid } from '@/lib/list-params'
import {
  courseCredentialOutputs,
  type CredentialFormat,
  type CredentialOutput,
} from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import { RecordDetailFields } from './_fields'
import { updateTrainingRecordField } from '../_actions'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'outputs', 'attachments', 'activity'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Training record · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

// Renew — mint a fresh record for the same person + course (completed today,
// expiry auto-computed from the course) and open it for inline edits. A header
// button: it copies the identity and lands you on the new record to adjust.
async function renewRecord(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  // A server action is a POST endpoint; the page's render-time gate does not
  // protect it. Recording (renewing) training requires training.record.create.
  assertCan(ctx, 'training.record.create')
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const existing = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(trainingRecords).where(eq(trainingRecords.id, id)).limit(1)
    return r
  })
  if (!existing) return

  const completedOn = new Date().toISOString().slice(0, 10)
  let expiresOn: string | null = null
  if (existing.courseId) {
    const courseId = existing.courseId
    const course = await ctx.db(async (tx) => {
      const [c] = await tx
        .select({ validForMonths: trainingCourses.validForMonths })
        .from(trainingCourses)
        .where(eq(trainingCourses.id, courseId))
        .limit(1)
      return c
    })
    if (course?.validForMonths) {
      const d = new Date(completedOn)
      d.setMonth(d.getMonth() + course.validForMonths)
      expiresOn = d.toISOString().slice(0, 10)
    }
  }

  let newId: string | undefined
  await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingRecords)
      .values({
        tenantId: ctx.tenantId,
        personId: existing.personId,
        courseId: existing.courseId,
        source: 'external_upload',
        completedOn,
        expiresOn,
        instructor: existing.instructor,
        issuedByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: trainingRecords.id })
    newId = row?.id
  })
  if (newId) {
    await recordAudit(ctx, {
      entityType: 'training_record',
      entityId: newId,
      action: 'create',
      summary: 'Record renewed (created replacement)',
      after: { previousRecordId: id, completedOn, expiresOn },
    })
  }
  revalidatePath(`/training/records/${id}`)
  if (newId) redirect(`/training/records/${newId}`)
}

async function revokeRecord(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  // Mutating (revoking) a training record requires training.record.create,
  // matching renewRecord and the bulk actions. Direct POSTs bypass the page gate.
  assertCan(ctx, 'training.record.create')
  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim() || null
  if (!id) return

  // Soft-revoke the record by marking deletedAt + revoking any active certs.
  await ctx.db(async (tx) => {
    await tx
      .update(trainingRecords)
      .set({ deletedAt: new Date(), notes: reason ? `Revoked: ${reason}` : 'Revoked' })
      .where(eq(trainingRecords.id, id))
    await tx
      .update(trainingCertificates)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(trainingCertificates.recordId, id), isNull(trainingCertificates.revokedAt)))
  })
  await recordAudit(ctx, {
    entityType: 'training_record',
    entityId: id,
    action: 'delete',
    summary: 'Record revoked',
    after: { reason },
  })
  revalidatePath(`/training/records/${id}`)
  revalidatePath('/training')
}

// ---------- Page ----------

export default async function TrainingRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  // Guard non-UUID segments (e.g. a stale /new path) — querying a uuid PK with
  // them throws instead of 404ing.
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        record: trainingRecords,
        person: people,
        course: trainingCourses,
      })
      .from(trainingRecords)
      // leftJoin: a brand-new draft has no person/course yet (both nullable).
      .leftJoin(people, eq(people.id, trainingRecords.personId))
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(eq(trainingRecords.id, id))
      .limit(1)
    if (!row) return null
    const [certAttachments, tenant, peopleList, coursesList] = await Promise.all([
      // Pull any uploaded scan attachments tagged with this record (by r2Key
      // prefix or exif metadata). The cert-route also lists them via r2 prefix.
      tx
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.kind, 'document'),
            like(attachments.r2Key, `training/records/${id}/%`),
          ),
        )
        .orderBy(desc(attachments.createdAt)),
      tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
        .then(([tenant]) => tenant),
      // Option lists for the editable person/course selects. The current
      // holder is added below in case they're no longer "active".
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
        .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
        .from(trainingCourses)
        .where(isNull(trainingCourses.deletedAt))
        .orderBy(asc(trainingCourses.name)),
    ])
    return {
      ...row,
      certAttachments,
      tenantSettings: tenant?.settings ?? {},
      peopleList,
      coursesList,
    }
  })

  if (!data) notFound()
  // Per-record visibility: training.read.all (or super-admin) → any record;
  // otherwise only the viewer's own training (record.personId === my person).
  // Closes the read-by-URL gap for users who hold only training.read.self.
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'training',
        personId: data.record.personId,
      }),
    ))
  )
    notFound()
  const { record, person, course, certAttachments, tenantSettings, peopleList, coursesList } = data
  const isRevoked = record.deletedAt != null
  // Ensure the current holder + course are selectable even if no longer active /
  // soft-deleted (the option lists only carry active rows). A blank draft has
  // neither yet, so there's nothing to inject.
  const peopleOptions =
    person && !peopleList.some((p) => p.id === person.id)
      ? [
          {
            id: person.id,
            firstName: person.firstName,
            lastName: person.lastName,
            employeeNo: person.employeeNo,
          },
          ...peopleList,
        ]
      : peopleList
  const courseOptions =
    course && !coursesList.some((c) => c.id === course.id)
      ? [{ id: course.id, name: course.name, code: course.code }, ...coursesList]
      : coursesList
  const credentialOutputs = courseCredentialOutputs(course?.metadata, tenantSettings)
  const certOutput = credentialOutputs.find((o) => o.format !== 'wallet') ?? credentialOutputs[0]
  const canDesignCredentials = canDesignTrainingCredentials(ctx)
  // Recording training (renew/revoke) is gated separately from viewing: a
  // read-only viewer (e.g. foreman with training.read.all) sees the record but
  // not the mutate forms. Mirrors the assertCan in renewRecord/revokeRecord.
  const canRecord = can(ctx, 'training.record.create')

  const today = new Date()
  const exp = record.expiresOn ? new Date(record.expiresOn) : null
  const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
  const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
    daysLeft === null ? 'no_expiry' : daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'ok'

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'training_record', id, 50) : []

  const basePath = `/training/records/${id}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training', label: 'Back to training' }}
          title={course?.name ?? 'New certificate'}
          subtitle={
            person
              ? `${person.firstName} ${person.lastName} · completed ${record.completedOn}`
              : 'Draft — choose a person and course below'
          }
          badge={
            <div className="flex items-center gap-2">
              {status === 'expired' ? (
                <Badge variant="destructive">Expired {Math.abs(daysLeft!)}d ago</Badge>
              ) : status === 'expiring' ? (
                <Badge variant="warning">{daysLeft}d left</Badge>
              ) : status === 'ok' ? (
                <Badge variant="success">Valid</Badge>
              ) : (
                <Badge variant="secondary">No expiry</Badge>
              )}
              {isRevoked ? <Badge variant="destructive">Revoked</Badge> : null}
            </div>
          }
          actions={
            certOutput || canRecord ? (
              <div className="flex items-center gap-2">
                {certOutput && !isRevoked ? (
                  <CredentialDownloadButton
                    endpoint={`${basePath}/certificate`}
                    outputId={certOutput.id}
                    variant="outline"
                    size="sm"
                    title={`Open ${certOutput.name}`}
                  >
                    <FileText size={14} /> Open certificate
                  </CredentialDownloadButton>
                ) : null}
                {canRecord ? (
                  <form action={renewRecord}>
                    <input type="hidden" name="id" value={id} />
                    <Button type="submit" variant="outline" size="sm">
                      <RotateCcw size={14} /> Renew
                    </Button>
                  </form>
                ) : null}
                {canRecord && !isRevoked ? (
                  <form action={revokeRecord}>
                    <input type="hidden" name="id" value={id} />
                    <ConfirmButton
                      message="Revoke this certificate? It will stop counting toward training and verification pages will show it as revoked."
                      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      <ShieldOff size={14} /> Revoke
                    </ConfirmButton>
                  </form>
                ) : null}
              </div>
            ) : undefined
          }
        />
      }
      alerts={
        isRevoked ? (
          <Alert variant="destructive">
            <AlertTitle>This record has been revoked</AlertTitle>
            <AlertDescription>
              The certificate is no longer valid; verification pages return a "revoked" status.
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
            { key: 'outputs', label: 'Cards & certificates', count: credentialOutputs.length },
            { key: 'attachments', label: 'Attachments', count: certAttachments.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            {/* At-a-glance summary */}
            <div className="grid grid-cols-3 gap-3">
              <StatTile
                icon={STATUS_META[status].icon}
                tone={STATUS_META[status].tone}
                label="Status"
                dense
                value={STATUS_META[status].value(daysLeft)}
                hint={record.expiresOn ? `Expires ${record.expiresOn}` : undefined}
                hintVariant={STATUS_META[status].badge}
              />
              <StatTile
                icon={CreditCard}
                tone="violet"
                label="Cards & certificates"
                dense
                value={credentialOutputs.length}
                href={`${basePath}?tab=outputs`}
              />
              <StatTile
                icon={Paperclip}
                tone="sky"
                label="Attachments"
                dense
                value={certAttachments.length}
                href={`${basePath}?tab=attachments`}
              />
            </div>

            <RecordDetailFields
              id={id}
              disabled={!canRecord || isRevoked}
              personHref={person ? `/people/${person.id}?tab=training` : null}
              courseHref={course ? `/training/courses/${course.id}` : null}
              options={{ people: peopleOptions, courses: courseOptions }}
              initial={{
                personId: record.personId ?? '',
                courseId: record.courseId ?? '',
                source: record.source,
                completedOn: record.completedOn,
                expiresOn: record.expiresOn ?? '',
                instructor: record.instructor ?? '',
                grade: record.grade != null ? String(record.grade) : '',
                details: record.details ?? '',
                notes: record.notes ?? '',
              }}
              updateAction={updateTrainingRecordField}
            />
          </>
        ) : null}

        {active === 'outputs' ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Cards & certificates ({credentialOutputs.length})</CardTitle>
                {canDesignCredentials ? (
                  <Link href="/training/credential-designs">
                    <Button variant="outline" size="sm">
                      <Settings size={14} /> Design
                    </Button>
                  </Link>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {credentialOutputs.map((output) => (
                  <div
                    key={output.id}
                    className="flex min-h-44 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-md border"
                        style={{
                          borderColor: output.accent,
                          color: output.primary,
                          backgroundColor: output.paper,
                        }}
                      >
                        <OutputIcon output={output} size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                          {output.name}
                        </div>
                        <div className="mt-1">
                          <Badge variant="secondary">{formatLabel(output.format)}</Badge>
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
                      {output.description}
                    </p>
                    <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                      Opens as a fresh PDF using the current design.
                    </div>
                    <div className="mt-auto pt-4">
                      <div className="flex flex-wrap gap-2">
                        <CredentialDownloadButton
                          endpoint={`/training/records/${id}/certificate`}
                          outputId={output.id}
                          variant="outline"
                          size="sm"
                          title={`Open ${output.name}`}
                        >
                          <OutputIcon output={output} /> Open PDF
                        </CredentialDownloadButton>
                        {output.format === 'wallet' ? (
                          <CredentialDownloadButton
                            endpoint={`/training/records/${id}/certificate`}
                            outputId={output.id}
                            action="print"
                            variant="outline"
                            size="sm"
                            title={`Print ${output.name}`}
                          >
                            <Printer size={14} /> Print
                          </CredentialDownloadButton>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {active === 'attachments' ? (
          <Card>
            <CardHeader>
              <CardTitle>Attachments ({certAttachments.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {certAttachments.length === 0 ? (
                <EmptyState
                  icon={<Paperclip size={24} />}
                  title="No attachments uploaded"
                  description="Scanned certificates, instructor notes, and other supporting documents appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certAttachments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.filename}</TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {a.contentType}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {humanSize(a.sizeBytes)}
                        </TableCell>
                        <TableCell>{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <a
                            href={publicUrl(a.r2Key)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                          >
                            Open →
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}

        {active === 'activity' ? (
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed entries={activity} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

const STATUS_META: Record<
  'ok' | 'expiring' | 'expired' | 'no_expiry',
  {
    tone: StatTone
    icon: typeof ShieldCheck
    badge: 'success' | 'warning' | 'destructive' | 'secondary'
    value: (daysLeft: number | null) => string
  }
> = {
  ok: {
    tone: 'emerald',
    icon: ShieldCheck,
    badge: 'success',
    value: (d) => (d != null ? `${d}d left` : 'Valid'),
  },
  expiring: {
    tone: 'amber',
    icon: ShieldAlert,
    badge: 'warning',
    value: (d) => `${d}d left`,
  },
  expired: {
    tone: 'rose',
    icon: ShieldX,
    badge: 'destructive',
    value: (d) => (d != null ? `${Math.abs(d)}d ago` : 'Expired'),
  },
  no_expiry: {
    tone: 'slate',
    icon: ShieldCheck,
    badge: 'secondary',
    value: () => 'No expiry',
  },
}

function OutputIcon({ output, size = 14 }: { output: CredentialOutput; size?: number }) {
  return output.format === 'wallet' ? <CreditCard size={size} /> : <FileText size={size} />
}

function formatLabel(format: CredentialFormat): string {
  if (format === 'wallet') return 'CR80 wallet'
  if (format === 'letter-portrait') return '8.5 x 11 portrait'
  return '11 x 8.5 landscape'
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
