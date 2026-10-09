import { FilterChips } from '@/components/filter-bar'
import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
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
  FileText,
  Paperclip,
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
} from '@beaconhs/ui'
import {
  attachments,
  people,
  tenants,
  trainingSkillAssignmentFiles,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import type { AppLocale } from '@beaconhs/i18n'
import { attachmentUrl } from '@/lib/attachment-url'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { canManageModule } from '@/lib/module-admin/guard'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity } from '@/lib/audit'
import { isUuid, parsePrefixedListParams, pickString } from '@/lib/list-params'
import { ActivityFeed } from '@/components/activity-feed'
import { CredentialOutputsCard } from '@/components/credential-outputs-card'
import { Pagination } from '@/components/pagination'
import { FilePreview } from '@/components/file-preview'
import { SearchInput } from '@/components/search-input'
import { StatTile, type StatTone } from '@/components/stat-tile'
import { TableToolbar } from '@/components/table-toolbar'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { skillCredentialOutputs } from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import { getConfiguredDirectPrintProviders } from '@/lib/direct-printing'
import { LiveField } from '@/components/live-field'
import { updateSkillExtraField } from '../../_lib/extra-fields-actions'
import { loadSkillInputPage } from '../../_lib/extra-field-query'
import {
  deleteSkillAssignmentFile,
  setSkillPrimaryFile,
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
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_02ba00984d4cb1', { value0: id.slice(0, 8) }) }
}

export default async function SkillAssignmentPage({
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
  const skillExtraListParams = parsePrefixedListParams(sp, 'skillExtra', {
    sort: 'order',
    dir: 'asc',
    perPage: 25,
    allowedSorts: EXTRA_SORTS,
  })
  const fileParams = parsePrefixedListParams(sp, 'file', {
    sort: 'uploaded',
    dir: 'desc',
    perPage: 12,
    allowedSorts: ['uploaded'] as const,
  })
  const fileKind = pickString(sp.fileKind)
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

    const [skillExtras, files, tenant] = await Promise.all([
      loadSkillInputPage(
        tx,
        id,
        row.type?.id ?? null,
        row.authority?.id ?? null,
        skillExtraListParams,
      ),
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
      files,
      tenantSettings: tenant?.settings ?? {},
    }
  })

  if (!data) notFound()
  const { assignment, type, authority, person, skillExtras, files } = data

  const isRevoked = assignment.deletedAt != null
  const canDesignCredentials = canDesignTrainingCredentials(ctx)
  const credentialOutputs = skillCredentialOutputs(
    type?.credentialOutputIds ?? [],
    data.tenantSettings,
  )
  const availablePrintProviders = await getConfiguredDirectPrintProviders(ctx)

  const today = new Date()
  const exp = assignment.expiresOn ? new Date(assignment.expiresOn) : null
  const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
  const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
    assignment.status === 'expired'
      ? 'expired'
      : daysLeft === null
        ? 'no_expiry'
        : daysLeft < 0
          ? 'expired'
          : daysLeft <= 90
            ? 'expiring'
            : 'ok'
  const statusMeta = STATUS_META[status]

  const drawer = pickString(sp.drawer)
  const basePath = `/training/skills/${id}`
  const matchedFiles = files.filter(
    ({ file, attachment }) =>
      (!fileKind || file.kind === fileKind) &&
      (!fileParams.q ||
        `${attachment?.filename ?? ''} ${file.label ?? ''}`
          .toLowerCase()
          .includes(fileParams.q.toLowerCase())),
  )
  const visibleFiles = matchedFiles.slice(
    (fileParams.page - 1) * fileParams.perPage,
    fileParams.page * fileParams.perPage,
  )
  const filesCloseHref = `${basePath}?tab=files`

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'training_skill', id, 50) : []

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/skills', label: 'Back to skills' }}
          title={tGeneratedValue(type?.name ?? tGenerated('m_11f7ed63086856'))}
          subtitle={tGeneratedValue(
            person
              ? `${person.firstName} ${person.lastName}${authority ? ` · ${authority.name}` : ''}`
              : tGenerated('m_1664499f85763e'),
          )}
          badge={
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  assignment.status === 'complete' || assignment.status === 'expired'
                    ? statusMeta.badge
                    : 'secondary'
                }
              >
                <GeneratedValue
                  value={
                    assignment.status !== 'complete' ? (
                      <GeneratedValue value={assignment.status} />
                    ) : status === 'expired' ? (
                      <GeneratedText
                        id="m_1b2d538989a8a4"
                        values={{ value0: Math.abs(daysLeft!) }}
                      />
                    ) : status === 'expiring' ? (
                      <GeneratedText id="m_13911b0824c79a" values={{ value0: daysLeft }} />
                    ) : status === 'ok' ? (
                      <GeneratedText id="m_1e418d0475450c" />
                    ) : (
                      <GeneratedText id="m_1bbc44c1ce26a7" />
                    )
                  }
                />
              </Badge>
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
            canManage ? (
              <div className="flex items-center gap-2">
                <form action={renewSkillAssignment}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline" size="sm">
                    <RotateCcw size={14} /> <GeneratedText id="m_1f6557a4319c50" />
                  </Button>
                </form>
                <GeneratedValue
                  value={
                    !isRevoked ? (
                      <form action={revokeSkillAssignment}>
                        <input type="hidden" name="id" value={id} />
                        <ConfirmButton
                          size="sm"
                          message={tGenerated('m_003a2fc34ed76d')}
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
              <GeneratedText id="m_062bd632b84f5f" />
            </AlertTitle>
            <AlertDescription>
              <GeneratedText id="m_173fdd8c5c9993" />
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
        <GeneratedValue
          value={
            active === 'overview' ? (
              <>
                {/* At-a-glance summary */}
                <div className="grid grid-cols-3 gap-3">
                  <StatTile
                    icon={statusMeta.icon}
                    tone={statusMeta.tone}
                    label={tGenerated('m_0b9da892d6faf0')}
                    dense
                    value={
                      assignment.status === 'complete'
                        ? statusMeta.value(daysLeft)
                        : assignment.status
                    }
                    hint={tGeneratedValue(
                      assignment.expiresOn
                        ? tGenerated('m_045cc1172f9f83', { value0: assignment.expiresOn })
                        : undefined,
                    )}
                    hintVariant={statusMeta.badge}
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
                    label={tGenerated('m_17a2e308162add')}
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
                    status: assignment.status,
                    notes: assignment.notes ?? '',
                  }}
                  updateAction={updateSkillAssignmentField}
                />

                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_108d0bb6ce6c90" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TableToolbar className="mb-3">
                      <SearchInput
                        paramKey="skillExtraQ"
                        pageParamKey="skillExtraPage"
                        placeholder={tGenerated('m_0395d8cd5ec2f6')}
                      />
                    </TableToolbar>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {skillExtras.rows.map((field) => (
                        <LiveField
                          key={`${assignment.skillTypeId}:${field.id}`}
                          id={id}
                          field={field.id}
                          label={field.field_key}
                          initialValue={field.field_value}
                          disabled={!canManage || isRevoked || !field.editable}
                          updateAction={updateSkillExtraField}
                        />
                      ))}
                    </div>
                    {skillExtras.total === 0 ? (
                      <p className="text-sm text-slate-500">
                        <GeneratedText id="m_19e976df1c6be7" />
                      </p>
                    ) : null}
                    <Pagination
                      basePath={basePath}
                      currentParams={sp}
                      total={skillExtras.total}
                      page={skillExtraListParams.page}
                      perPage={skillExtraListParams.perPage}
                      pageParamKey="skillExtraPage"
                    />
                  </CardContent>
                </Card>
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
                availablePrintProviders={availablePrintProviders}
              />
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'files' ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2">
                      <Paperclip size={16} /> <GeneratedText id="m_09a3c98fe10087" />
                      <GeneratedValue value={files.length} />)
                    </CardTitle>
                    <GeneratedValue
                      value={
                        canManage ? (
                          <Link href={`${basePath}?tab=files&drawer=upload-file`}>
                            <Button size="sm">
                              <GeneratedText id="m_06dc5804d9c769" />
                            </Button>
                          </Link>
                        ) : null
                      }
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <TableToolbar>
                    <SearchInput
                      paramKey="fileQ"
                      pageParamKey="filePage"
                      placeholder={tGenerated('m_1f5c890597604d')}
                    />
                    <FilterChips
                      basePath={basePath}
                      currentParams={sp}
                      paramKey="fileKind"
                      label={tGenerated('m_1e578efe1574cd')}
                      clearParams={['filePage']}
                      options={[
                        { value: 'certificate', label: 'Certificate' },
                        { value: 'evidence', label: 'Supporting evidence' },
                        { value: 'photo', label: 'Photo' },
                        { value: 'other', label: 'Other' },
                      ]}
                    />
                  </TableToolbar>
                  <GeneratedValue
                    value={
                      matchedFiles.length === 0 ? (
                        <EmptyState
                          icon={<Paperclip size={24} />}
                          title={tGenerated('m_1192d4035da0ad')}
                          description={tGenerated('m_07ee6d4ea6e07d')}
                        />
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          <GeneratedValue
                            value={visibleFiles.map(({ file, attachment }) => (
                              <FileCard
                                key={file.id}
                                assignmentId={id}
                                file={file}
                                attachment={attachment}
                                canManage={canManage}
                                timeZone={ctx.timezone}
                                locale={ctx.locale}
                              />
                            ))}
                          />
                        </div>
                      )
                    }
                  />
                  <Pagination
                    basePath={basePath}
                    currentParams={sp}
                    total={matchedFiles.length}
                    page={fileParams.page}
                    perPage={fileParams.perPage}
                    pageParamKey="filePage"
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

      <GeneratedValue
        value={
          canManage ? (
            <SkillFilesDrawer
              assignmentId={id}
              open={drawer === 'upload-file'}
              closeHref={filesCloseHref}
            />
          ) : null
        }
      />
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
  locale,
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
  locale: AppLocale
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const href = attachment ? attachmentUrl(attachment.id) : null
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <a
        href={href ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={href ? '' : 'pointer-events-none'}
      >
        {href && attachment ? (
          <FilePreview url={href} contentType={attachment.contentType} label={file.label} />
        ) : null}
      </a>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              <GeneratedValue value={file.label} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-normal capitalize">
                <GeneratedValue value={file.kind.replace('_', ' ')} />
              </Badge>
              <GeneratedValue
                value={
                  attachment ? (
                    <span className="text-[11px] text-slate-400">
                      <GeneratedValue value={humanSize(attachment.sizeBytes)} />
                    </span>
                  ) : (
                    <span className="text-[11px] text-rose-500">
                      <GeneratedText id="m_0d47513e440f05" />
                    </span>
                  )
                }
              />
            </div>
          </div>
          <GeneratedValue
            value={
              canManage ? (
                <form action={deleteSkillAssignmentFile}>
                  <input type="hidden" name="id" value={file.id} />
                  <input type="hidden" name="assignmentId" value={assignmentId} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 p-0 text-slate-400 hover:text-red-600"
                    title={tGenerated('m_0c470a36b6b277')}
                  >
                    <Trash2 size={14} />
                  </Button>
                </form>
              ) : null
            }
          />
        </div>
        {canManage && attachment ? (
          <form action={setSkillPrimaryFile} className="mt-2">
            <input type="hidden" name="id" value={file.id} />
            <input type="hidden" name="assignmentId" value={assignmentId} />
            <Button variant="outline" size="sm" type="submit">
              <GeneratedText id="m_115047e16b9618" />
            </Button>
          </form>
        ) : null}
        <div className="mt-auto pt-2 text-[11px] text-slate-400 dark:text-slate-500">
          <GeneratedValue value={formatDate(new Date(file.uploadedAt), timeZone, locale)} />
          <GeneratedValue
            value={
              href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 font-medium text-teal-700 hover:underline dark:text-teal-300"
                >
                  <GeneratedText id="m_0871fb8eeeedd0" />
                </a>
              ) : null
            }
          />
        </div>
      </div>
    </div>
  )
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
