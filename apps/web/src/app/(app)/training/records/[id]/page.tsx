import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNull, like } from 'drizzle-orm'
import { Award, FileText, IdCard, Paperclip, RotateCcw, ShieldOff } from 'lucide-react'
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

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'certificate', 'wallet', 'attachments', 'activity'] as const
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
    const [certs, certAttachments] = await Promise.all([
      tx
        .select()
        .from(trainingCertificates)
        .where(eq(trainingCertificates.recordId, id))
        .orderBy(desc(trainingCertificates.createdAt)),
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
    ])
    return { ...row, certs, certAttachments }
  })

  if (!data) notFound()
  const { record, person, course, certs, certAttachments } = data
  const isRevoked = record.deletedAt != null

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
          actions={
            <>
              <CredentialDownloadButton
                endpoint={`/training/records/${id}/certificate`}
                format="wallet"
                variant="outline"
              >
                <IdCard size={14} /> Wallet card
              </CredentialDownloadButton>
              <CredentialDownloadButton
                endpoint={`/training/records/${id}/certificate`}
                format="cert"
                variant="outline"
              >
                <FileText size={14} /> Certificate PDF
              </CredentialDownloadButton>
            </>
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
            { key: 'certificate', label: 'Certificate', count: certs.length },
            { key: 'wallet', label: 'Wallet card' },
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
                { label: 'Certificate type', value: record.certificateType ?? '—' },
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
                Creates a new training record for the same person + course with a fresh expiry.
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
                    placeholder={course.validForMonths ? `auto: +${course.validForMonths}mo` : ''}
                  />
                </Field>
                <Field label="Instructor">
                  <Input name="instructor" defaultValue={record.instructor ?? ''} />
                </Field>
                <Field label="Grade %">
                  <Input name="grade" type="number" min="0" max="100" placeholder="optional" />
                </Field>
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea name="notes" rows={2} placeholder="What was renewed?" />
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
                    <Input name="reason" placeholder="Why is this being revoked?" />
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

        {active === 'certificate' ? (
          <Card>
            <CardHeader>
              <CardTitle>Issued certificates ({certs.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {certs.length === 0 ? (
                <EmptyState
                  icon={<Award size={24} />}
                  title="No certificate generated yet"
                  description="Click 'Certificate PDF' in the header to generate one — it will be rendered by the worker and stored against this record."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Verify token</TableHead>
                      <TableHead>Generated</TableHead>
                      <TableHead>Revoked</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certs.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.verifyToken}</TableCell>
                        <TableCell>{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {c.revokedAt ? (
                            <Badge variant="destructive">
                              {new Date(c.revokedAt).toLocaleDateString()}
                            </Badge>
                          ) : (
                            <Badge variant="success">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/verify/${c.verifyToken}` as any}
                            target="_blank"
                            className="text-xs text-teal-700 hover:underline"
                          >
                            Verify page →
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}

        {active === 'wallet' ? (
          <Card>
            <CardHeader>
              <CardTitle>Wallet card preview</CardTitle>
            </CardHeader>
            <CardContent>
              <WalletCardPreview
                person={person}
                course={course}
                completedOn={record.completedOn}
                expiresOn={record.expiresOn ?? null}
                grade={record.grade}
                instructor={record.instructor ?? null}
                verifyToken={certs[0]?.verifyToken ?? null}
              />
              <div className="mt-4 flex justify-end">
                <CredentialDownloadButton
                  endpoint={`/training/records/${id}/certificate`}
                  format="wallet"
                  variant="outline"
                >
                  <IdCard size={14} /> Download wallet PDF
                </CredentialDownloadButton>
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
                  description="Scanned certificates, instructor notes, and other supporting documents appear here when uploaded under the training/records/{id}/ prefix."
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

function WalletCardPreview({
  person,
  course,
  completedOn,
  expiresOn,
  grade,
  instructor,
  verifyToken,
}: {
  person: typeof people.$inferSelect
  course: typeof trainingCourses.$inferSelect
  completedOn: string
  expiresOn: string | null
  grade: number | null
  instructor: string | null
  verifyToken: string | null
}) {
  return (
    <div className="flex justify-center">
      <div className="w-[340px] rounded-xl border-2 border-teal-700 bg-gradient-to-br from-teal-50 to-white p-5 shadow-md">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div className="text-[10px] font-semibold tracking-wider text-teal-700 uppercase">
              Certificate of Training
            </div>
            <div className="mt-0.5 text-base font-bold text-slate-900">
              {person.firstName} {person.lastName}
            </div>
            {person.employeeNo ? (
              <div className="text-xs text-slate-500">Emp #{person.employeeNo}</div>
            ) : null}
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-700 text-white">
            <Award size={22} />
          </div>
        </div>
        <div className="mt-2 text-sm font-semibold text-slate-900">{course.name}</div>
        <div className="text-xs text-slate-600">{course.code}</div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <Cell label="Completed">{completedOn}</Cell>
          <Cell label="Expires">{expiresOn ?? '—'}</Cell>
          <Cell label="Grade">{grade != null ? `${grade}%` : '—'}</Cell>
          <Cell label="Instructor">{instructor ?? '—'}</Cell>
        </div>
        {verifyToken ? (
          <div className="mt-3 border-t border-teal-200 pt-2 text-center font-mono text-[10px] text-slate-600">
            Verify: {verifyToken.slice(0, 16)}…
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded bg-white/60 p-1.5">
      <div className="text-[9px] tracking-wide text-teal-700 uppercase">{label}</div>
      <div className="text-slate-900">{children}</div>
    </div>
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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
