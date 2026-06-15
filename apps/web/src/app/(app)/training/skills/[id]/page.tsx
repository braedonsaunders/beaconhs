// Skill-assignment detail — one page per per-person skill / certification
// (training_skill_assignments). Display + edit are unified: managers edit the
// mutable fields inline (autosave), everyone else sees them read-only. Surfaces
// credential card/certificate export, supporting-file uploads, the catalogue
// fields inherited from the skill type + authority, and activity.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, desc, eq } from 'drizzle-orm'
import {
  CreditCard,
  FileImage,
  FileText,
  Paperclip,
  Printer,
  RotateCcw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
} from 'lucide-react'
import {
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
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { recentActivityForEntity } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { ActivityFeed } from '@/components/activity-feed'
import { CredentialDownloadButton } from '@/components/credential-download-button'
import { StatTile, type StatTone } from '@/components/stat-tile'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  enabledCredentialOutputs,
  type CredentialFormat,
  type CredentialOutput,
} from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import { ExtraFieldsSection } from '../../_components/extra-fields-section'
import { addExtraField, deleteExtraField } from '../../_lib/extra-fields-actions'
import {
  deleteSkillAssignment,
  deleteSkillAssignmentFile,
  renewSkillAssignment,
  saveSkillAssignment,
} from '../_actions'
import { SkillOverview } from './_overview'
import { SkillFilesDrawer } from './_files-drawer'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'outputs', 'files', 'activity'] as const
type Tab = (typeof TABS)[number]

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
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        assignment: trainingSkillAssignments,
        type: trainingSkillTypes,
        authority: trainingSkillAuthorities,
        person: people,
      })
      .from(trainingSkillAssignments)
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .where(eq(trainingSkillAssignments.id, id))
      .limit(1)
    if (!row) return null

    const [skillExtras, typeExtras, authorityExtras, files, tenant] = await Promise.all([
      tx
        .select()
        .from(trainingExtraFields)
        .where(and(eq(trainingExtraFields.ownerType, 'skill'), eq(trainingExtraFields.ownerId, id)))
        .orderBy(asc(trainingExtraFields.sortOrder), asc(trainingExtraFields.createdAt)),
      tx
        .select()
        .from(trainingExtraFields)
        .where(
          and(
            eq(trainingExtraFields.ownerType, 'skill_type'),
            eq(trainingExtraFields.ownerId, row.type.id),
          ),
        )
        .orderBy(asc(trainingExtraFields.sortOrder), asc(trainingExtraFields.createdAt)),
      tx
        .select()
        .from(trainingExtraFields)
        .where(
          and(
            eq(trainingExtraFields.ownerType, 'authority'),
            eq(trainingExtraFields.ownerId, row.authority.id),
          ),
        )
        .orderBy(asc(trainingExtraFields.sortOrder), asc(trainingExtraFields.createdAt)),
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

  const canManage = canManageModule(ctx, 'training')
  const canDesignCredentials = canDesignTrainingCredentials(ctx)
  const credentialOutputs = enabledCredentialOutputs(data.tenantSettings)
  const certOutput = credentialOutputs.find((o) => o.format !== 'wallet') ?? credentialOutputs[0]

  const today = new Date()
  const exp = assignment.expiresOn ? new Date(assignment.expiresOn) : null
  const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
  const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
    daysLeft === null ? 'no_expiry' : daysLeft < 0 ? 'expired' : daysLeft <= 90 ? 'expiring' : 'ok'
  const statusMeta = STATUS_META[status]

  const drawer = pickString(sp.drawer)
  const basePath = `/training/skills/${id}`
  const filesCloseHref = `${basePath}?tab=files`

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'training_skill', id, 50) : []

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/skills', label: 'Back to skills' }}
          title={type.name}
          subtitle={`${person.firstName} ${person.lastName} · ${authority.name}`}
          badge={
            <Badge variant={statusMeta.badge}>
              {status === 'expired'
                ? `Expired ${Math.abs(daysLeft!)}d ago`
                : status === 'expiring'
                  ? `${daysLeft}d left`
                  : status === 'ok'
                    ? 'Valid'
                    : 'No expiry'}
            </Badge>
          }
          actions={
            certOutput ? (
              <CredentialDownloadButton
                endpoint={`${basePath}/certificate`}
                outputId={certOutput.id}
                size="sm"
                title={`Open ${certOutput.name}`}
              >
                <FileText size={14} /> Open certificate
              </CredentialDownloadButton>
            ) : undefined
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
                compact
                value={statusMeta.value(daysLeft)}
                hint={assignment.expiresOn ? `Expires ${assignment.expiresOn}` : undefined}
                hintVariant={statusMeta.badge}
              />
              <StatTile
                icon={CreditCard}
                tone="violet"
                label="Cards & certificates"
                value={credentialOutputs.length}
                href={`${basePath}?tab=outputs`}
              />
              <StatTile
                icon={Paperclip}
                tone="sky"
                label="Files"
                value={files.length}
                href={`${basePath}?tab=files`}
              />
            </div>

            {/* Unified display + edit surface */}
            <SkillOverview
              assignmentId={id}
              canManage={canManage}
              person={{
                id: person.id,
                firstName: person.firstName,
                lastName: person.lastName,
                employeeNo: person.employeeNo,
              }}
              type={{ id: type.id, name: type.name, code: type.code }}
              authority={{ id: authority.id, name: authority.name }}
              validForMonths={type.validForMonths}
              initial={{
                grantedOn: assignment.grantedOn,
                expiresOn: assignment.expiresOn ?? '',
                notes: assignment.notes ?? '',
              }}
              saveAction={saveSkillAssignment}
            />

            {/* Catalogue fields inherited from the skill type + its authority */}
            {typeExtras.length > 0 ? (
              <ReadOnlyFields
                title={`Skill type fields (${typeExtras.length})`}
                subtitle={`From the ${type.name} catalogue entry.`}
                rows={typeExtras}
                manageHref={canManage ? `/training/skills/types/${type.id}?tab=extras` : null}
              />
            ) : null}
            {authorityExtras.length > 0 ? (
              <ReadOnlyFields
                title={`Authority fields (${authorityExtras.length})`}
                subtitle={`From ${authority.name}.`}
                rows={authorityExtras}
                manageHref={canManage ? `/training/authorities/${authority.id}?tab=extras` : null}
              />
            ) : null}

            {/* Per-assignment custom fields — editable by managers */}
            {canManage ? (
              <ExtraFieldsSection
                ownerType="skill"
                ownerId={id}
                rows={skillExtras.map((e) => ({
                  id: e.id,
                  fieldKey: e.fieldKey,
                  fieldValue: e.fieldValue,
                }))}
                drawerOpen={drawer === 'add-extra-field'}
                drawerCloseHref={basePath}
                addHref={`${basePath}?drawer=add-extra-field`}
                addAction={addExtraField}
                deleteAction={deleteExtraField}
              />
            ) : skillExtras.length > 0 ? (
              <ReadOnlyFields
                title={`Additional fields (${skillExtras.length})`}
                rows={skillExtras}
              />
            ) : null}

            {/* Lifecycle actions — managers only */}
            {canManage ? (
              <Card>
                <CardHeader>
                  <CardTitle>Manage</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={renewSkillAssignment}>
                      <input type="hidden" name="id" value={id} />
                      <Button type="submit" variant="outline" size="sm">
                        <RotateCcw size={14} /> Renew
                      </Button>
                    </form>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Issues a fresh assignment for the same person &amp; skill, then opens it.
                    </span>
                  </div>
                  <form action={deleteSkillAssignment} className="shrink-0">
                    <input type="hidden" name="id" value={id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 size={14} /> Delete
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}

        {active === 'outputs' ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Cards &amp; certificates ({credentialOutputs.length})</CardTitle>
                {canDesignCredentials ? (
                  <Link href="/training/credential-designs">
                    <Button variant="outline" size="sm">
                      <Settings size={14} /> Design
                    </Button>
                  </Link>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {credentialOutputs.map((output) => (
                  <div
                    key={output.id}
                    className="flex min-h-44 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
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
                    <p className="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                      {output.description}
                    </p>
                    <div className="mt-auto pt-4">
                      <div className="flex flex-wrap gap-2">
                        <CredentialDownloadButton
                          endpoint={`${basePath}/certificate`}
                          outputId={output.id}
                          variant="outline"
                          size="sm"
                          title={`Open ${output.name}`}
                        >
                          <OutputIcon output={output} /> Open PDF
                        </CredentialDownloadButton>
                        {output.format === 'wallet' ? (
                          <CredentialDownloadButton
                            endpoint={`${basePath}/certificate`}
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
              <ActivityFeed entries={activity} />
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
}: {
  assignmentId: string
  file: { id: string; label: string; kind: string; uploadedAt: Date | string }
  attachment: {
    r2Key: string
    filename: string
    contentType: string
    sizeBytes: number
  } | null
  canManage: boolean
}) {
  const isImage = attachment?.contentType.startsWith('image/') ?? false
  const href = attachment ? publicUrl(attachment.r2Key) : null
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
            // eslint-disable-next-line @next/next/no-img-element
            <img src={href} alt={file.label} className="h-full w-full object-cover" />
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
          {new Date(file.uploadedAt).toLocaleDateString()}
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
  manageHref,
}: {
  title: string
  subtitle?: string
  rows: { id: string; fieldKey: string; fieldValue: string | null }[]
  manageHref?: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
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
      </CardContent>
    </Card>
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
