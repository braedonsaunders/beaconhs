import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import {
  CreditCard,
  Paperclip,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldX,
  Trash2,
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
  trainingCourses,
  trainingRecordFiles,
  trainingRecords,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { CredentialOutputsCard } from '@/components/credential-outputs-card'
import { ConfirmButton } from '@/components/confirm-button'
import { StatTile, type StatTone } from '@/components/stat-tile'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { isUuid, parseListParams } from '@/lib/list-params'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { courseCredentialOutputs } from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import { RecordDetailFields } from './_fields'
import { TrainingRecordFilesDrawer } from './_files-drawer'
import {
  deleteTrainingRecordFile,
  renewTrainingRecord,
  revokeTrainingRecord,
  updateTrainingRecordField,
} from '../_actions'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'outputs', 'attachments', 'activity'] as const
type Tab = (typeof TABS)[number]
const ATTACHMENT_SORTS = ['uploaded'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_10c6a7950c0fbe', { value0: id.slice(0, 8) }) }
}

// ---------- Page ----------

export default async function TrainingRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  // Guard non-UUID segments (e.g. a stale /new path) — querying a uuid PK with
  // them throws instead of 404ing.
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')
  const drawer = typeof sp.drawer === 'string' ? sp.drawer : null
  const attachmentParams = parseListParams(
    {
      q: sp.attachmentQ,
      sort: sp.attachmentSort,
      dir: sp.attachmentDir,
      page: sp.attachmentPage,
      perPage: sp.attachmentPerPage,
    },
    {
      sort: 'uploaded',
      dir: 'desc',
      perPage: 25,
      allowedSorts: ATTACHMENT_SORTS,
    },
  )
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
    const attachmentBase = eq(trainingRecordFiles.recordId, id)
    const attachmentSearch = attachmentParams.q
      ? or(
          ilike(trainingRecordFiles.label, `%${attachmentParams.q}%`),
          ilike(trainingRecordFiles.kind, `%${attachmentParams.q}%`),
          ilike(attachments.filename, `%${attachmentParams.q}%`),
          ilike(attachments.contentType, `%${attachmentParams.q}%`),
        )
      : undefined
    const attachmentWhere = and(attachmentBase, attachmentSearch)
    const [
      attachmentCountRows,
      filteredAttachmentCountRows,
      certAttachments,
      tenant,
      peopleList,
      coursesList,
    ] = await Promise.all([
      tx.select({ c: count() }).from(trainingRecordFiles).where(attachmentBase),
      active === 'attachments'
        ? tx
            .select({ c: count() })
            .from(trainingRecordFiles)
            .innerJoin(attachments, eq(attachments.id, trainingRecordFiles.attachmentId))
            .where(attachmentWhere)
        : Promise.resolve([]),
      // Pull only the visible page of uploaded scans. Counts remain available
      // on every tab for the tab badge and overview statistic.
      active === 'attachments'
        ? tx
            .select({ file: trainingRecordFiles, attachment: attachments })
            .from(trainingRecordFiles)
            .innerJoin(attachments, eq(attachments.id, trainingRecordFiles.attachmentId))
            .where(attachmentWhere)
            .orderBy(desc(trainingRecordFiles.uploadedAt))
            .limit(attachmentParams.perPage)
            .offset((attachmentParams.page - 1) * attachmentParams.perPage)
        : Promise.resolve([]),
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
      attachmentCount: Number(attachmentCountRows[0]?.c ?? 0),
      filteredAttachmentCount: Number(filteredAttachmentCountRows[0]?.c ?? 0),
      tenantSettings: tenant?.settings ?? {},
      peopleList,
      coursesList,
    }
  })

  if (!data) notFound()
  // Per-record visibility: training.read.all (or super-admin) → any record;
  // otherwise only the viewer's own training (record.personId === my person).
  // Closes the read-by-URL gap for users who hold only training.read.self.
  // training.record.create also qualifies: recording staff work with other
  // people's records (and a fresh "New certificate" draft has no person yet,
  // which would otherwise 404 for its own creator).
  if (
    !can(ctx, 'training.record.create') &&
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'training',
        personId: data.record.personId,
      }),
    ))
  )
    notFound()
  const {
    record,
    person,
    course,
    certAttachments,
    attachmentCount,
    filteredAttachmentCount,
    tenantSettings,
    peopleList,
    coursesList,
  } = data
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
  const canDesignCredentials = canDesignTrainingCredentials(ctx)
  // Recording training (renew/revoke) is gated separately from viewing: a
  // read-only viewer (e.g. foreman with training.read.all) sees the record but
  // not the mutate forms. The imported actions repeat this permission gate.
  const canRecord = can(ctx, 'training.record.create')

  const today = new Date()
  const exp = record.expiresOn ? new Date(record.expiresOn) : null
  const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
  const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
    daysLeft === null ? 'no_expiry' : daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'ok'

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'training_record', id, 50) : []

  const basePath = `/training/records/${id}`
  const attachmentsCloseHref = `${basePath}?tab=attachments`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training', label: 'Back to training' }}
          title={tGeneratedValue(course?.name ?? tGenerated('m_0889fafbafcb00'))}
          subtitle={tGeneratedValue(
            person
              ? tGenerated('m_0df15e651a113a', {
                  value0: person.firstName,
                  value1: person.lastName,
                  value2: record.completedOn,
                })
              : tGenerated('m_1c6434960eeef6'),
          )}
          badge={
            <div className="flex items-center gap-2">
              <GeneratedValue
                value={
                  status === 'expired' ? (
                    <Badge variant="destructive">
                      <GeneratedText id="m_13f7150c94b182" />{' '}
                      <GeneratedValue value={Math.abs(daysLeft!)} />
                      <GeneratedText id="m_0ced4968a01894" />
                    </Badge>
                  ) : status === 'expiring' ? (
                    <Badge variant="warning">
                      <GeneratedValue value={daysLeft} />
                      <GeneratedText id="m_0a3d63460246cf" />
                    </Badge>
                  ) : status === 'ok' ? (
                    <Badge variant="success">
                      <GeneratedText id="m_1e418d0475450c" />
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <GeneratedText id="m_1bbc44c1ce26a7" />
                    </Badge>
                  )
                }
              />
              <GeneratedValue
                value={
                  isRevoked ? (
                    <Badge variant="destructive">
                      <GeneratedText id="m_1ae9fac75309ce" />
                    </Badge>
                  ) : null
                }
              />
            </div>
          }
          actions={
            canRecord ? (
              <div className="flex items-center gap-2">
                <form action={renewTrainingRecord}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline" size="sm">
                    <RotateCcw size={14} /> <GeneratedText id="m_1f6557a4319c50" />
                  </Button>
                </form>
                <GeneratedValue
                  value={
                    !isRevoked ? (
                      <form action={revokeTrainingRecord}>
                        <input type="hidden" name="id" value={id} />
                        <ConfirmButton
                          size="sm"
                          message={tGenerated('m_1612be0ce800f1')}
                          className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          <ShieldOff size={14} /> <GeneratedText id="m_18718dd379a57d" />
                        </ConfirmButton>
                      </form>
                    ) : null
                  }
                />
              </div>
            ) : undefined
          }
        />
      }
      alerts={
        isRevoked ? (
          <Alert variant="destructive">
            <AlertTitle>
              <GeneratedText id="m_13ef5a4866fb5d" />
            </AlertTitle>
            <AlertDescription>
              <GeneratedText id="m_18b63410e5f4b0" />
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
            { key: 'attachments', label: 'Attachments', count: attachmentCount },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        <GeneratedValue
          value={
            active === 'overview' ? (
              <>
                {/* At-a-glance summary */}
                <div className="grid grid-cols-3 gap-3">
                  <StatTile
                    icon={STATUS_META[status].icon}
                    tone={STATUS_META[status].tone}
                    label={tGenerated('m_0b9da892d6faf0')}
                    dense
                    value={STATUS_META[status].value(daysLeft)}
                    hint={tGeneratedValue(
                      record.expiresOn
                        ? tGenerated('m_045cc1172f9f83', { value0: record.expiresOn })
                        : undefined,
                    )}
                    hintVariant={STATUS_META[status].badge}
                  />
                  <StatTile
                    icon={CreditCard}
                    tone="violet"
                    label={tGenerated('m_19f4fcf54639f4')}
                    dense
                    value={credentialOutputs.length}
                    href={`${basePath}?tab=outputs`}
                  />
                  <StatTile
                    icon={Paperclip}
                    tone="sky"
                    label={tGenerated('m_014ac1a664bf4b')}
                    dense
                    value={attachmentCount}
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
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'outputs' ? (
              <CredentialOutputsCard
                outputs={credentialOutputs}
                endpoint={`${basePath}/certificate`}
                canDesign={canDesignCredentials}
                unavailable={isRevoked}
              />
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'attachments' ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>
                      <GeneratedText id="m_18b330a9afec8b" />
                      <GeneratedValue value={attachmentCount} />)
                    </CardTitle>
                    <GeneratedValue
                      value={
                        canRecord ? (
                          <Link href={`${basePath}?tab=attachments&drawer=upload-file`}>
                            <Button size="sm">
                              <Plus size={14} /> <GeneratedText id="m_03cb1d648a3cb1" />
                            </Button>
                          </Link>
                        ) : null
                      }
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <TableToolbar className="mb-3">
                    <SearchInput
                      placeholder={tGenerated('m_1de6fe9adadcdc')}
                      paramKey="attachmentQ"
                      pageParamKey="attachmentPage"
                    />
                  </TableToolbar>
                  <GeneratedValue
                    value={
                      certAttachments.length === 0 ? (
                        <EmptyState
                          icon={<Paperclip size={24} />}
                          title={tGeneratedValue(
                            attachmentParams.q
                              ? tGenerated('m_1f8894c4202845')
                              : tGenerated('m_15cb3d3f501ead'),
                          )}
                          description={tGeneratedValue(
                            attachmentParams.q
                              ? tGenerated('m_15087d86fa6d56')
                              : tGenerated('m_159b908318c026'),
                          )}
                        />
                      ) : (
                        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>
                                  <GeneratedText id="m_102a42d098d1d2" />
                                </TableHead>
                                <TableHead>
                                  <GeneratedText id="m_074ba2f160c506" />
                                </TableHead>
                                <TableHead>
                                  <GeneratedText id="m_11ad4bbeced31b" />
                                </TableHead>
                                <TableHead>
                                  <GeneratedText id="m_028e286aa7b299" />
                                </TableHead>
                                <TableHead></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <GeneratedValue
                                value={certAttachments.map(({ file, attachment: a }) => (
                                  <TableRow key={file.id}>
                                    <TableCell className="font-medium">
                                      <div>
                                        <GeneratedValue value={file.label} />
                                      </div>
                                      <div className="text-xs font-normal text-slate-500">
                                        <GeneratedValue value={a.filename} />
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-slate-600 dark:text-slate-400">
                                      <GeneratedValue value={file.kind.replace('_', ' ')} />
                                    </TableCell>
                                    <TableCell className="text-slate-600 dark:text-slate-400">
                                      <GeneratedValue value={humanSize(a.sizeBytes)} />
                                    </TableCell>
                                    <TableCell>
                                      <GeneratedValue
                                        value={formatDate(
                                          new Date(file.uploadedAt),
                                          ctx.timezone,
                                          ctx.locale,
                                        )}
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center justify-end gap-1">
                                        <a
                                          href={attachmentUrl(a.id)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                                        >
                                          <GeneratedText id="m_0871fb8eeeedd0" />
                                        </a>
                                        {canRecord ? (
                                          <form action={deleteTrainingRecordFile}>
                                            <input type="hidden" name="id" value={file.id} />
                                            <input type="hidden" name="recordId" value={id} />
                                            <Button
                                              type="submit"
                                              size="sm"
                                              variant="ghost"
                                              className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                                              title={tGenerated('m_1daffe3e5eee41')}
                                            >
                                              <Trash2 size={14} />
                                            </Button>
                                          </form>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              />
                            </TableBody>
                          </Table>
                          <Pagination
                            basePath={basePath}
                            currentParams={sp}
                            total={filteredAttachmentCount}
                            page={attachmentParams.page}
                            perPage={attachmentParams.perPage}
                            pageParamKey="attachmentPage"
                          />
                        </div>
                      )
                    }
                  />
                </CardContent>
              </Card>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'activity' ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_14b78af1b2f95e" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
                </CardContent>
              </Card>
            ) : null
          }
        />
      </div>
      {canRecord ? (
        <TrainingRecordFilesDrawer
          recordId={id}
          open={drawer === 'upload-file'}
          closeHref={attachmentsCloseHref}
        />
      ) : null}
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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
