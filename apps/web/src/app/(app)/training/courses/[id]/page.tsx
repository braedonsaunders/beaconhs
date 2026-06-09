import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, desc, eq } from 'drizzle-orm'
import { FileText, GraduationCap, Plus, Trash2 } from 'lucide-react'
import {
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
  trainingClasses,
  trainingCourseFiles,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { CourseDrawers } from './_drawers'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'records', 'classes', 'files'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Course · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

async function addCourseFileAction(input: {
  courseId: string
  attachmentId: string
  label: string | null
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  const { courseId, attachmentId, label } = input
  if (!courseId || !attachmentId) return { ok: false, error: 'Missing fields' }

  await ctx.db(async (tx) => {
    const [highest] = await tx
      .select({ s: trainingCourseFiles.sortOrder })
      .from(trainingCourseFiles)
      .where(eq(trainingCourseFiles.courseId, courseId))
      .orderBy(desc(trainingCourseFiles.sortOrder))
      .limit(1)
    const next = (highest?.s ?? -1) + 1
    await tx.insert(trainingCourseFiles).values({
      tenantId: ctx.tenantId,
      courseId,
      attachmentId,
      label,
      sortOrder: next,
    })
  })
  await recordAudit(ctx, {
    entityType: 'training_course',
    entityId: courseId,
    action: 'update',
    summary: `Attached file${label ? ` "${label}"` : ''}`,
    after: { attachmentId, label },
  })
  revalidatePath(`/training/courses/${courseId}`)
  return { ok: true }
}

async function removeCourseFile(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const courseId = String(formData.get('courseId') ?? '')
  const fileId = String(formData.get('fileId') ?? '')
  if (!courseId || !fileId) return

  await ctx.db((tx) =>
    tx.delete(trainingCourseFiles).where(eq(trainingCourseFiles.id, fileId)),
  )
  await recordAudit(ctx, {
    entityType: 'training_course',
    entityId: courseId,
    action: 'delete',
    summary: 'Detached course file',
    before: { fileId },
  })
  revalidatePath(`/training/courses/${courseId}`)
}

// ---------- Page ----------

export default async function CoursePage({
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
    const [course] = await tx.select().from(trainingCourses).where(eq(trainingCourses.id, id)).limit(1)
    if (!course) return null
    const records = await tx
      .select({ record: trainingRecords, person: people })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .where(eq(trainingRecords.courseId, id))
      .orderBy(desc(trainingRecords.completedOn))
    const classes = await tx
      .select()
      .from(trainingClasses)
      .where(eq(trainingClasses.courseId, id))
      .orderBy(desc(trainingClasses.startsAt))
    const files = await tx
      .select({ file: trainingCourseFiles, att: attachments })
      .from(trainingCourseFiles)
      .leftJoin(attachments, eq(attachments.id, trainingCourseFiles.attachmentId))
      .where(eq(trainingCourseFiles.courseId, id))
      .orderBy(asc(trainingCourseFiles.sortOrder), asc(trainingCourseFiles.createdAt))
    return { course, records, classes, files }
  })

  if (!data) notFound()
  const { course, records, classes, files } = data
  const today = new Date()
  const basePath = `/training/courses/${id}`
  const closeHref = `${basePath}${active === 'overview' ? '' : `?tab=${active}`}`
  const drawerParam = pickString(sp.drawer)
  const openDrawer = drawerParam === 'add-course-file' ? 'add-course-file' : null

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training', label: 'Back to training' }}
          title={course.name}
          subtitle={course.code}
          badge={<Badge variant="secondary">{course.deliveryType.replace('_', ' ')}</Badge>}
          actions={
            <div className="flex items-center gap-2">
              <Link href={`/training/learn/${id}`}>
                <Button variant="outline">
                  <GraduationCap size={14} /> Preview
                </Button>
              </Link>
              <Link href={`${basePath}/studio`}>
                <Button>
                  <Plus size={14} /> Build content
                </Button>
              </Link>
            </div>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'records', label: 'Records', count: records.length },
            { key: 'classes', label: 'Classes', count: classes.length },
            { key: 'files', label: 'Files', count: files.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <DetailGrid
              rows={[
                { label: 'Code', value: course.code },
                { label: 'Delivery', value: course.deliveryType.replace('_', ' ') },
                { label: 'Duration', value: course.durationMinutes ? `${course.durationMinutes} min` : '—' },
                { label: 'Valid for', value: course.validForMonths ? `${course.validForMonths} months` : 'no expiry' },
                { label: 'Requires evaluator', value: course.requiresEvaluator ? 'Yes' : 'No' },
              ]}
            />
            {course.description ? (
              <Card>
                <CardHeader>
                  <CardTitle>Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{course.description}</p>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}

        {active === 'records' ? (
          <Card>
            <CardHeader>
              <CardTitle>Records ({records.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {records.length === 0 ? (
                <EmptyState
                  icon={<GraduationCap size={24} />}
                  title="Nobody has completed this course yet"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Grade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((row) => {
                      const exp = row.record.expiresOn ? new Date(row.record.expiresOn) : null
                      const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
                      return (
                        <TableRow key={row.record.id}>
                          <TableCell>
                            <Link href={`/people/${row.person.id}`} className="font-medium text-slate-900 hover:underline">
                              {row.person.lastName}, {row.person.firstName}
                            </Link>
                          </TableCell>
                          <TableCell>{row.record.completedOn}</TableCell>
                          <TableCell>{row.record.expiresOn ?? '—'}</TableCell>
                          <TableCell>
                            {daysLeft === null ? (
                              <Badge variant="secondary">No expiry</Badge>
                            ) : daysLeft < 0 ? (
                              <Badge variant="destructive">Expired</Badge>
                            ) : daysLeft <= 30 ? (
                              <Badge variant="warning">{daysLeft}d left</Badge>
                            ) : (
                              <Badge variant="success">Valid</Badge>
                            )}
                          </TableCell>
                          <TableCell>{row.record.grade != null ? `${row.record.grade}%` : '—'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}

        {active === 'classes' ? (
          <Card>
            <CardHeader>
              <CardTitle>Scheduled classes ({classes.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {classes.length === 0 ? (
                <p className="text-sm text-slate-500">No classes scheduled.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {classes.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2">
                      <Link
                        href={`/training/classes/${c.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {c.title}
                      </Link>
                      <span className="text-xs text-slate-500">
                        {new Date(c.startsAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {active === 'files' ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Files ({files.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {files.length === 0 ? (
                  <EmptyState
                    icon={<FileText size={24} />}
                    title="No files attached"
                    description="Upload study material, handouts, or recordings so anyone with course access can grab them."
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {files.map(({ file, att }) => {
                      const url = att?.r2Key ? publicUrl(att.r2Key) : null
                      const display = file.label ?? att?.filename ?? 'Untitled file'
                      const size =
                        att?.sizeBytes != null
                          ? `${(Number(att.sizeBytes) / 1024).toFixed(0)} KB`
                          : null
                      return (
                        <li
                          key={file.id}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 font-medium text-slate-900 hover:text-teal-700 hover:underline"
                              >
                                <FileText size={14} className="text-slate-400" />
                                <span className="truncate">{display}</span>
                              </a>
                            ) : (
                              <div className="flex items-center gap-2 text-slate-500">
                                <FileText size={14} className="text-slate-400" />
                                <span className="truncate">{display}</span>
                                <Badge variant="secondary">missing</Badge>
                              </div>
                            )}
                            <div className="ml-6 text-[11px] text-slate-500">
                              {att?.contentType ?? 'unknown'} {size ? `· ${size}` : ''}
                            </div>
                          </div>
                          <form action={removeCourseFile} className="inline">
                            <input type="hidden" name="courseId" value={id} />
                            <input type="hidden" name="fileId" value={file.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              aria-label="Remove file"
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </Button>
                          </form>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
            <div className="flex justify-end">
              <Link href={`${basePath}?tab=files&drawer=add-course-file`}>
                <Button type="button">
                  <Plus size={14} /> Attach file
                </Button>
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      <CourseDrawers
        courseId={id}
        openDrawer={openDrawer}
        closeHref={closeHref}
        addCourseFileAction={addCourseFileAction}
      />
    </DetailPageLayout>
  )
}
