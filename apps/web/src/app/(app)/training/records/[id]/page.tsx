import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNull, like } from 'drizzle-orm'
import {
  CreditCard,
  FileText,
  Paperclip,
  Printer,
  RotateCcw,
  Settings,
  ShieldOff,
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
  Input,
  Label,
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
  people,
  tenants,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { CredentialDownloadButton } from '@/components/credential-download-button'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  enabledCredentialOutputs,
  type CredentialFormat,
  type CredentialOutput,
} from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'outputs', 'attachments', 'activity'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Training record · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

async function renewRecord(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const completedOnRaw = String(formData.get('completedOn') ?? '').trim()
  const expiresOnRaw = String(formData.get('expiresOn') ?? '').trim() || null
  const grade = formData.get('grade') ? Number(formData.get('grade')) : null
  const instructor = String(formData.get('instructor') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!id || !completedOnRaw) return

  const existing = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(trainingRecords).where(eq(trainingRecords.id, id)).limit(1)
    return r
  })
  if (!existing) return

  // Auto-compute expiry from the course if not supplied.
  let expiresOn: string | null = expiresOnRaw
  if (!expiresOn) {
    const course = await ctx.db(async (tx) => {
      const [c] = await tx
        .select({ validForMonths: trainingCourses.validForMonths })
        .from(trainingCourses)
        .where(eq(trainingCourses.id, existing.courseId))
        .limit(1)
      return c
    })
    if (course?.validForMonths) {
      const d = new Date(completedOnRaw)
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
        completedOn: completedOnRaw,
        expiresOn,
        grade,
        instructor,
        notes,
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
      after: { previousRecordId: id, completedOn: completedOnRaw, expiresOn },
    })
  }
  revalidatePath(`/training/records/${id}`)
  if (newId) redirect(`/training/records/${newId}`)
}

async function revokeRecord(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
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
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(eq(trainingRecords.id, id))
      .limit(1)
    if (!row) return null
    const [certAttachments, tenant] = await Promise.all([
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
    ])
    return { ...row, certAttachments, tenantSettings: tenant?.settings ?? {} }
  })

  if (!data) notFound()
  const { record, person, course, certAttachments, tenantSettings } = data
  const isRevoked = record.deletedAt != null
  const credentialOutputs = enabledCredentialOutputs(tenantSettings)
  const canDesignCredentials = canDesignTrainingCredentials(ctx)

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
          title={course.name}
          subtitle={`${person.firstName} ${person.lastName} · completed ${record.completedOn}`}
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
            <DetailGrid
              rows={[
                {
                  label: 'Person',
                  value: (
                    <Link href={`/people/${person.id}`} className="text-teal-700 hover:underline">
                      {person.firstName} {person.lastName}
                    </Link>
                  ),
                },
                {
                  label: 'Course',
                  value: (
                    <Link
                      href={`/training/courses/${course.id}`}
                      className="text-teal-700 hover:underline"
                    >
                      {course.code} · {course.name}
                    </Link>
                  ),
                },
                { label: 'Source', value: record.source.replace('_', ' ') },
                { label: 'Completed on', value: record.completedOn },
                { label: 'Expires on', value: record.expiresOn ?? '—' },
                { label: 'Instructor', value: record.instructor ?? '—' },
                { label: 'Grade', value: record.grade != null ? `${record.grade}%` : '—' },
                { label: 'Credential type', value: record.certificateType ?? '—' },
              ]}
            />
            {record.details ? (
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap text-slate-700">{record.details}</p>
                </CardContent>
              </Card>
            ) : null}
            {record.notes ? (
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap text-slate-700">{record.notes}</p>
                </CardContent>
              </Card>
            ) : null}

            <Section title="Renew this training">
              <p className="mb-3 text-sm text-slate-600">
                Creates a new training record for the same person and course with a fresh expiry.
                Useful for refresher courses or external recertification.
              </p>
              <form action={renewRecord} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={id} />
                <Field label="Completed on" required>
                  <Input
                    name="completedOn"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                  />
                </Field>
                <Field label="Expires on">
                  <Input
                    name="expiresOn"
                    type="date"
                    placeholder={
                      course.validForMonths ? `Defaults to +${course.validForMonths} months` : ''
                    }
                  />
                </Field>
                <Field label="Instructor">
                  <Input name="instructor" defaultValue={record.instructor ?? ''} />
                </Field>
                <Field label="Grade %">
                  <Input name="grade" type="number" min="0" max="100" placeholder="Optional" />
                </Field>
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea name="notes" rows={2} placeholder="Notes about this renewal" />
                </Field>
                <div className="flex justify-end sm:col-span-2">
                  <Button type="submit">
                    <RotateCcw size={14} /> Renew
                  </Button>
                </div>
              </form>
            </Section>

            {!isRevoked ? (
              <Section title="Revoke this record">
                <p className="mb-3 text-sm text-slate-600">
                  Marks the record and any active certificates as revoked. Verification pages will
                  return a revoked status. This action is recorded in the audit log.
                </p>
                <form action={revokeRecord} className="space-y-3 text-sm">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Reason">
                    <Input name="reason" placeholder="Reason for revocation" />
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit" variant="destructive">
                      <ShieldOff size={14} /> Revoke
                    </Button>
                  </div>
                </form>
              </Section>
            ) : null}
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
                    className="flex min-h-44 flex-col rounded-lg border border-slate-200 bg-white p-4"
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
                        <div className="truncate font-semibold text-slate-900">{output.name}</div>
                        <div className="mt-1">
                          <Badge variant="secondary">{formatLabel(output.format)}</Badge>
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-600">{output.description}</p>
                    <div className="mt-4 text-xs text-slate-500">
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
                        <TableCell className="text-slate-600">{a.contentType}</TableCell>
                        <TableCell className="text-slate-600">{humanSize(a.sizeBytes)}</TableCell>
                        <TableCell>{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <a
                            href={publicUrl(a.r2Key)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-teal-700 hover:underline"
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
