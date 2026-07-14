// Skill-assignment detail — one page per per-person skill / certification
// (training_skill_assignments). Display + edit are unified: managers edit the
// mutable fields inline (autosave), everyone else sees them read-only. Surfaces
// credential card/certificate export, supporting-file uploads, the catalogue
// fields inherited from the skill type + authority, and activity.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import {
  CreditCard,
  FileImage,
  FileText,
  Paperclip,
  RotateCcw,
  Settings,
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
} from '@beaconhs/ui'
import {
  attachments,
  people,
  tenants,
  trainingExtraFields,
  trainingSkillAssignmentFiles,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { canManageModule } from '@/lib/module-admin/guard'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity } from '@/lib/audit'
import { isUuid, mergeHref, parsePrefixedListParams, pickString } from '@/lib/list-params'
import { ActivityFeed } from '@/components/activity-feed'
import { CredentialOutputsCard } from '@/components/credential-outputs-card'
import { Pagination } from '@/components/pagination'
import { RawImage } from '@/components/raw-image'
import { SearchInput } from '@/components/search-input'
import { StatTile, type StatTone } from '@/components/stat-tile'
import { TableToolbar } from '@/components/table-toolbar'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { enabledCredentialOutputs } from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import { ExtraFieldsSection } from '../../_components/extra-fields-section'
import { addExtraField, deleteExtraField } from '../../_lib/extra-fields-actions'
import { loadTrainingExtraFieldPage } from '../../_lib/extra-field-query'
import {
  deleteSkillAssignmentFile,
  renewSkillAssignment,
  revokeSkillAssignment,
  updateSkillAssignmentField,
} from '../_actions'
import { SkillDetailFields } from './_fields'
import { SkillFilesDrawer } from './_files-drawer'
import { ConfirmButton } from '@/components/confirm-button'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'outputs', 'files', 'activity'] as const
type Tab = (typeof TABS)[number]
const EXTRA_SORTS = ['order'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Skill · ${id.slice(0, 8)}` }
}

export default async function SkillAssignmentPage({
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
  const skillExtraListParams = parsePrefixedListParams(sp, 'skillExtra', {
    sort: 'order',
    dir: 'asc',
    perPage: 25,
    allowedSorts: EXTRA_SORTS,
  })
  const typeExtraListParams = parsePrefixedListParams(sp, 'typeExtra', {
    sort: 'order',
    dir: 'asc',
    perPage: 25,
    allowedSorts: EXTRA_SORTS,
  })
  const authorityExtraListParams = parsePrefixedListParams(sp, 'authorityExtra', {
    sort: 'order',
    dir: 'asc',
    perPage: 25,
    allowedSorts: EXTRA_SORTS,
  })
  const ctx = await requireRequestContext()
  const canManage = canManageModule(ctx, 'training')

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        assignment: trainingSkillAssignments,
        type: trainingSkillTypes,
        authority: trainingSkillAuthorities,
        person: people,
      })
      .from(trainingSkillAssignments)
      // leftJoin: a brand-new draft has no person/skill type yet (both nullable).
      .leftJoin(trainingSkillTypes, eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId))
      .leftJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .leftJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .where(eq(trainingSkillAssignments.id, id))
      .limit(1)
    if (!row) return null

    // Per-record visibility (mirrors /training/records/[id]): managers and
    // read.all see any skill; everyone else only their own. Closes the
    // read-by-URL gap exposing notes, extra fields, and evidence files.
    if (
      !canManage &&
      !(await canSeeRecord(ctx, tx, {
        prefix: 'training',
        personId: row.assignment.personId,
      }))
    )
      return null

    const [skillExtras, typeExtras, authorityExtras, files, tenant] = await Promise.all([
      loadTrainingExtraFieldPage(
        tx,
        eq(trainingExtraFields.skillAssignmentId, id),
        skillExtraListParams,
      ),
      row.type
        ? loadTrainingExtraFieldPage(
            tx,
            eq(trainingExtraFields.skillTypeId, row.type.id),
            typeExtraListParams,
          )
        : Promise.resolve({ rows: [], total: 0, filteredTotal: 0 }),
      row.authority
        ? loadTrainingExtraFieldPage(
            tx,
            eq(trainingExtraFields.authorityId, row.authority.id),
            authorityExtraListParams,
          )
        : Promise.resolve({ rows: [], total: 0, filteredTotal: 0 }),
      tx
        .select({ file: trainingSkillAssignmentFiles, attachment: attachments })
        .from(trainingSkillAssignmentFiles)
        .leftJoin(attachments, eq(attachments.id, trainingSkillAssignmentFiles.attachmentId))
        .where(eq(trainingSkillAssignmentFiles.skillAssignmentId, id))
        .orderBy(desc(trainingSkillAssignmentFiles.uploadedAt)),
      tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
        .then(([t]) => t),
    ])

    return {
      ...row,
      skillExtras,
      typeExtras,
      authorityExtras,
      files,
      tenantSettings: tenant?.settings ?? {},
    }
  })

  if (!data) notFound()
  const { assignment, type, authority, person, skillExtras, typeExtras, authorityExtras, files } =
    data

  const isRevoked = assignment.deletedAt != null
  const canDesignCredentials = canDesignTrainingCredentials(ctx)
  const credentialOutputs = enabledCredentialOutputs(data.tenantSettings)

  const today = new Date()
  const exp = assignment.expiresOn ? new Date(assignment.expiresOn) : null
  const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
  const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
    daysLeft === null ? 'no_expiry' : daysLeft < 0 ? 'expired' : daysLeft <= 90 ? 'expiring' : 'ok'
  const statusMeta = STATUS_META[status]

  const drawer = pickString(sp.drawer)
  const basePath = `/training/skills/${id}`
  const filesCloseHref = `${basePath}?tab=files`
  const extraFieldDrawerCloseHref = mergeHref(basePath, sp, { drawer: undefined })

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'training_skill', id, 50) : []

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/skills', label: 'Back to skills' }}
          title={type?.name ?? 'New skill'}
          subtitle={
            person
              ? `${person.firstName} ${person.lastName}${authority ? ` · ${authority.name}` : ''}`
              : 'Draft — choose a person and skill below'
          }
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={statusMeta.badge}>
                {status === 'expired'
                  ? `Expired ${Math.abs(daysLeft!)}d ago`
                  : status === 'expiring'
                    ? `${daysLeft}d left`
                    : status === 'ok'
                      ? 'Valid'
                      : 'No expiry'}
              </Badge>
              {isRevoked ? <Badge variant="destructive">Revoked</Badge> : null}
            </div>
          }
          actions={
            canManage ? (
              <div className="flex items-center gap-2">
                <form action={renewSkillAssignment}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline" size="sm">
                    <RotateCcw size={14} /> Renew
                  </Button>
                </form>
                {!isRevoked ? (
                  <form action={revokeSkillAssignment}>
                    <input type="hidden" name="id" value={id} />
                    <ConfirmButton
                      size="sm"
                      message="Revoke this skill? It will stop counting toward training and verification pages will show it as revoked."
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
            <AlertTitle>This skill has been revoked</AlertTitle>
            <AlertDescription>
              It no longer counts toward training; verification pages return a "revoked" status.
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
            { key: 'files', label: 'Files', count: files.length },
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
                icon={statusMeta.icon}
                tone={statusMeta.tone}
                label="Status"
                dense
                value={statusMeta.value(daysLeft)}
                hint={assignment.expiresOn ? `Expires ${assignment.expiresOn}` : undefined}
                hintVariant={statusMeta.badge}
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
                label="Files"
                dense
                value={files.length}
                href={`${basePath}?tab=files`}
              />
            </div>

            {/* Unified display + edit surface */}
            <SkillDetailFields
              id={id}
              disabled={!canManage || isRevoked}
              personHref={person ? `/people/${person.id}?tab=skills` : null}
              initialOptions={{
                person: person
                  ? {
                      value: person.id,
                      label: `${person.lastName}, ${person.firstName}`,
                      hint: person.employeeNo ?? undefined,
                    }
                  : undefined,
                skillType: type
                  ? {
                      value: type.id,
                      label: `${authority?.name ?? '—'} · ${type.code ? `${type.code} · ` : ''}${type.name}`,
                    }
                  : undefined,
              }}
              initial={{
                personId: assignment.personId ?? '',
                skillTypeId: assignment.skillTypeId ?? '',
                grantedOn: assignment.grantedOn,
                expiresOn: assignment.expiresOn ?? '',
                notes: assignment.notes ?? '',
              }}
              updateAction={updateSkillAssignmentField}
            />

            {/* Catalogue fields inherited from the skill type + its authority */}
            {type && (typeExtras.total > 0 || typeExtraListParams.q) ? (
              <ReadOnlyFields
                title="Skill type fields"
                subtitle={`From the ${type.name} catalogue entry.`}
                rows={typeExtras.rows}
                total={typeExtras.total}
                filteredTotal={typeExtras.filteredTotal}
                query={typeExtraListParams.q}
                page={typeExtraListParams.page}
                perPage={typeExtraListParams.perPage}
                basePath={basePath}
                currentParams={sp}
                queryParamKey="typeExtraQ"
                pageParamKey="typeExtraPage"
                manageHref={canManage ? `/training/skills/types/${type.id}?tab=extras` : null}
              />
            ) : null}
            {authority && (authorityExtras.total > 0 || authorityExtraListParams.q) ? (
              <ReadOnlyFields
                title="Authority fields"
                subtitle={`From ${authority.name}.`}
                rows={authorityExtras.rows}
                total={authorityExtras.total}
                filteredTotal={authorityExtras.filteredTotal}
                query={authorityExtraListParams.q}
                page={authorityExtraListParams.page}
                perPage={authorityExtraListParams.perPage}
                basePath={basePath}
                currentParams={sp}
                queryParamKey="authorityExtraQ"
                pageParamKey="authorityExtraPage"
                manageHref={canManage ? `/training/authorities/${authority.id}?tab=extras` : null}
              />
            ) : null}

            {/* Per-assignment custom fields — editable by managers */}
            {canManage ? (
              <ExtraFieldsSection
                ownerType="skill"
                ownerId={id}
                rows={skillExtras.rows}
                list={{
                  basePath,
                  currentParams: sp,
                  total: skillExtras.total,
                  filteredTotal: skillExtras.filteredTotal,
                  query: skillExtraListParams.q,
                  page: skillExtraListParams.page,
                  perPage: skillExtraListParams.perPage,
                  queryParamKey: 'skillExtraQ',
                  pageParamKey: 'skillExtraPage',
                }}
                drawerOpen={drawer === 'add-extra-field'}
                drawerCloseHref={extraFieldDrawerCloseHref}
                addHref={mergeHref(basePath, sp, { drawer: 'add-extra-field' })}
                addAction={addExtraField}
                deleteAction={deleteExtraField}
              />
            ) : skillExtras.total > 0 || skillExtraListParams.q ? (
              <ReadOnlyFields
                title="Additional fields"
                rows={skillExtras.rows}
                total={skillExtras.total}
                filteredTotal={skillExtras.filteredTotal}
                query={skillExtraListParams.q}
                page={skillExtraListParams.page}
                perPage={skillExtraListParams.perPage}
                basePath={basePath}
                currentParams={sp}
                queryParamKey="skillExtraQ"
                pageParamKey="skillExtraPage"
              />
            ) : null}
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

        {active === 'files' ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <Paperclip size={16} /> Files ({files.length})
                </CardTitle>
                {canManage ? (
                  <Link href={`${basePath}?tab=files&drawer=upload-file`}>
                    <Button size="sm">Upload file</Button>
                  </Link>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {files.length === 0 ? (
                <EmptyState
                  icon={<Paperclip size={24} />}
                  title="No files uploaded"
                  description="Scanned certificates, renewal letters, ID copies, and other supporting documents appear here."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {files.map(({ file, attachment }) => (
                    <FileCard
                      key={file.id}
                      assignmentId={id}
                      file={file}
                      attachment={attachment}
                      canManage={canManage}
                      timeZone={ctx.timezone}
                    />
                  ))}
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

      {canManage ? (
        <SkillFilesDrawer
          assignmentId={id}
          open={drawer === 'upload-file'}
          closeHref={filesCloseHref}
        />
      ) : null}
    </DetailPageLayout>
  )
}

// ---------- status presentation ----------

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

// ---------- file card ----------

function FileCard({
  assignmentId,
  file,
  attachment,
  canManage,
  timeZone,
}: {
  assignmentId: string
  file: { id: string; label: string; kind: string; uploadedAt: Date | string }
  attachment: {
    id: string
    r2Key: string
    filename: string
    contentType: string
    sizeBytes: number
  } | null
  canManage: boolean
  timeZone: string
}) {
  const isImage = attachment?.contentType.startsWith('image/') ?? false
  const href = attachment ? attachmentUrl(attachment.id) : null
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <a
        href={href ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={href ? '' : 'pointer-events-none'}
      >
        <div className="grid h-28 place-items-center overflow-hidden bg-slate-50 dark:bg-slate-950/40">
          {isImage && href ? (
            <RawImage
              src={href}
              alt={file.label}
              optimizationReason="authenticated"
              className="h-full w-full object-cover"
            />
          ) : (
            <FileGlyph contentType={attachment?.contentType ?? ''} />
          )}
        </div>
      </a>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {file.label}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-normal capitalize">
                {file.kind.replace('_', ' ')}
              </Badge>
              {attachment ? (
                <span className="text-[11px] text-slate-400">
                  {humanSize(attachment.sizeBytes)}
                </span>
              ) : (
                <span className="text-[11px] text-rose-500">file missing</span>
              )}
            </div>
          </div>
          {canManage ? (
            <form action={deleteSkillAssignmentFile}>
              <input type="hidden" name="id" value={file.id} />
              <input type="hidden" name="assignmentId" value={assignmentId} />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                className="h-7 w-7 shrink-0 p-0 text-slate-400 hover:text-red-600"
                title="Delete file"
              >
                <Trash2 size={14} />
              </Button>
            </form>
          ) : null}
        </div>
        <div className="mt-auto pt-2 text-[11px] text-slate-400 dark:text-slate-500">
          {formatDate(new Date(file.uploadedAt), timeZone)}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 font-medium text-teal-700 hover:underline dark:text-teal-300"
            >
              Open →
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function FileGlyph({ contentType }: { contentType: string }) {
  const isImg = contentType.startsWith('image/')
  const isPdf = contentType === 'application/pdf'
  return (
    <span
      className={
        isPdf
          ? 'text-rose-400 dark:text-rose-500'
          : isImg
            ? 'text-sky-400 dark:text-sky-500'
            : 'text-slate-300 dark:text-slate-600'
      }
    >
      {isImg ? <FileImage size={40} strokeWidth={1.5} /> : <FileText size={40} strokeWidth={1.5} />}
    </span>
  )
}

// ---------- read-only field list (catalogue / non-manager extras) ----------

function ReadOnlyFields({
  title,
  subtitle,
  rows,
  total,
  filteredTotal,
  query,
  page,
  perPage,
  basePath,
  currentParams,
  queryParamKey,
  pageParamKey,
  manageHref,
}: {
  title: string
  subtitle?: string
  rows: { id: string; fieldKey: string; fieldValue: string | null }[]
  total: number
  filteredTotal: number
  query?: string
  page: number
  perPage: number
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  queryParamKey: string
  pageParamKey: string
  manageHref?: string | null
}) {
  const countLabel =
    filteredTotal === total
      ? total.toLocaleString()
      : `${filteredTotal.toLocaleString()} of ${total.toLocaleString()}`
  const isOutOfRange = filteredTotal > 0 && rows.length === 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>
              {title} ({countLabel})
            </CardTitle>
            {subtitle ? (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
            ) : null}
          </div>
          {manageHref ? (
            <Link href={manageHref}>
              <Button variant="outline" size="sm">
                <Settings size={14} /> Manage
              </Button>
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <TableToolbar className="mb-3">
          <SearchInput
            placeholder="Search field name or value…"
            paramKey={queryParamKey}
            pageParamKey={pageParamKey}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Settings size={24} />}
            title={isOutOfRange ? 'No fields on this page' : 'No fields match your search'}
            description={
              isOutOfRange
                ? 'Use the pagination control to return to the last page.'
                : query
                  ? 'Clear the search to see other additional fields.'
                  : 'No additional fields have been configured.'
            }
          />
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-col gap-0.5">
                <dt className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  {r.fieldKey}
                </dt>
                <dd className="break-words text-slate-900 dark:text-slate-100">
                  {r.fieldValue && r.fieldValue.length > 0 ? r.fieldValue : '—'}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <Pagination
          basePath={basePath}
          currentParams={currentParams}
          total={filteredTotal}
          page={page}
          perPage={perPage}
          pageParamKey={pageParamKey}
        />
      </CardContent>
    </Card>
  )
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
