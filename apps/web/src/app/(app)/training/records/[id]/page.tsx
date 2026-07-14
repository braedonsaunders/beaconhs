import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, isNull, like, or } from 'drizzle-orm'
import {
  CreditCard,
  Paperclip,
  RotateCcw,
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
import { attachments, people, tenants, trainingCourses, trainingRecords } from '@beaconhs/db/schema'
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
import { renewTrainingRecord, revokeTrainingRecord, updateTrainingRecordField } from '../_actions'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'outputs', 'attachments', 'activity'] as const
type Tab = (typeof TABS)[number]
const ATTACHMENT_SORTS = ['uploaded'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Training record · ${id.slice(0, 8)}` }
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
    const attachmentBase = and(
      eq(attachments.kind, 'document'),
      like(attachments.r2Key, `t/${ctx.tenantId}/document/training-records/${id}/%`),
    )
    const attachmentSearch = attachmentParams.q
      ? or(
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
      tx.select({ c: count() }).from(attachments).where(attachmentBase),
      active === 'attachments'
        ? tx.select({ c: count() }).from(attachments).where(attachmentWhere)
        : Promise.resolve([]),
      // Pull only the visible page of uploaded scans. Counts remain available
      // on every tab for the tab badge and overview statistic.
      active === 'attachments'
        ? tx
            .select()
            .from(attachments)
            .where(attachmentWhere)
            .orderBy(desc(attachments.createdAt))
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
            canRecord ? (
              <div className="flex items-center gap-2">
                <form action={renewTrainingRecord}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline" size="sm">
                    <RotateCcw size={14} /> Renew
                  </Button>
                </form>
                {!isRevoked ? (
                  <form action={revokeTrainingRecord}>
                    <input type="hidden" name="id" value={id} />
                    <ConfirmButton
                      size="sm"
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
            { key: 'attachments', label: 'Attachments', count: attachmentCount },
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
        ) : null}

        {active === 'outputs' ? (
          <CredentialOutputsCard
            outputs={credentialOutputs}
            endpoint={`${basePath}/certificate`}
            canDesign={canDesignCredentials}
            unavailable={isRevoked}
          />
        ) : null}

        {active === 'attachments' ? (
          <Card>
            <CardHeader>
              <CardTitle>Attachments ({attachmentCount})</CardTitle>
            </CardHeader>
            <CardContent>
              <TableToolbar className="mb-3">
                <SearchInput
                  placeholder="Search attachments…"
                  paramKey="attachmentQ"
                  pageParamKey="attachmentPage"
                />
              </TableToolbar>
              {certAttachments.length === 0 ? (
                <EmptyState
                  icon={<Paperclip size={24} />}
                  title={
                    attachmentParams.q
                      ? 'No attachments match your search'
                      : 'No attachments uploaded'
                  }
                  description={
                    attachmentParams.q
                      ? 'Try a different filename or file type.'
                      : 'Scanned certificates, instructor notes, and other supporting documents appear here.'
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
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
                          <TableCell>{formatDate(new Date(a.createdAt), ctx.timezone)}</TableCell>
                          <TableCell>
                            <a
                              href={attachmentUrl(a.id)}
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
                  <Pagination
                    basePath={basePath}
                    currentParams={sp}
                    total={filteredAttachmentCount}
                    page={attachmentParams.page}
                    perPage={attachmentParams.perPage}
                    pageParamKey="attachmentPage"
                  />
                </div>
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
              <ActivityFeed entries={activity} timeZone={ctx.timezone} />
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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
