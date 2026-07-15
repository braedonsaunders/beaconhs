import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// Per-app records list — the "home" of a Builder app when pinned to the
// sidebar. Behaves like a native module: a list of entries (form responses)
// for THIS template, each row opening the entry's record page
// (/apps/responses/[id]). Columns, default sort and the default status filter
// are app-configurable via recordConfig.list (designer → List tab). New entries
// create a draft and open the same unified create/edit/view record page. Uses
// the shared native list chrome (ListPageLayout / PageHeader / Table / etc.).

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ClipboardCheck, Plus, Settings2 } from 'lucide-react'
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { localizeText, type AppLocale } from '@beaconhs/i18n'
import {
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { moduleScopeWhere } from '@/lib/visibility'
import { createDraftResponse } from '@/app/(app)/apps/templates/[id]/fill/actions'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { canAccessTemplate } from '@/app/(app)/apps/_lib/access'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'

export const dynamic = 'force-dynamic'

const SORTS = ['submitted_at', 'created_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'non_compliant', label: 'Non-compliant' },
  { value: 'in_review', label: 'In review' },
  { value: 'closed', label: 'Closed' },
  { value: 'rejected', label: 'Rejected' },
]

// --- App-configurable list (recordConfig.list, authored in designer → List) --

type ListColumnConfig = { key: string; source: 'builtin' | 'field'; label?: string }
type ListConfig = {
  columns?: ListColumnConfig[]
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  defaultStatus?: string
}

const BUILTIN_LABEL: Record<string, string> = {
  id: 'ID',
  subject: 'Subject',
  site: 'Site',
  status: 'Status',
  created_at: 'Started',
  submitted_at: 'Submitted',
  submittedBy: 'By',
  pdf: 'PDF',
}
const SORTABLE_BUILTINS = new Set(['status', 'created_at', 'submitted_at'])
const DEFAULT_COLUMNS: ListColumnConfig[] = [
  { key: 'id', source: 'builtin' },
  { key: 'subject', source: 'builtin' },
  { key: 'site', source: 'builtin' },
  { key: 'status', source: 'builtin' },
  { key: 'created_at', source: 'builtin' },
  { key: 'submitted_at', source: 'builtin' },
  { key: 'submittedBy', source: 'builtin' },
  { key: 'pdf', source: 'builtin' },
]

type SchemaField = {
  id: string
  label?: Record<string, string>
  type?: string
  validation?: { options?: { value: string; label?: Record<string, string> }[] }
}

// Lightweight cell formatter for app-field columns (scalars / selects / arrays).
function formatListCell(
  field: SchemaField | undefined,
  raw: unknown,
  locale: AppLocale,
  defaultLocale: AppLocale,
): string {
  if (raw == null || raw === '') return '—'
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(', ') || '—'
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (typeof o.answer === 'string') return o.answer
    if (typeof o.name === 'string') return o.name
    return '—'
  }
  const opts = field?.validation?.options
  if (opts) {
    const match = opts.find((o) => o.value === raw)
    if (match) return localizeText(match.label, locale, String(raw), defaultLocale)
  }
  return String(raw)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) return { title: tGenerated('m_0d0fb7b561ec9d') }
  const ctx = await requireRequestContext()
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)
  const [tmpl] = await ctx.db((tx) =>
    tx
      .select({
        name: formTemplates.name,
        status: formTemplates.status,
        allowedRoles: formTemplates.allowedRoles,
        deletedAt: formTemplates.deletedAt,
      })
      .from(formTemplates)
      .where(eq(formTemplates.id, id))
      .limit(1),
  )
  return {
    title:
      tmpl && canAccessTemplate(ctx, tmpl, effectiveRoleKeys, 'browse-records')
        ? tmpl.name
        : tGenerated('m_0d0fb7b561ec9d'),
  }
}

export default async function AppRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const ctx = await requireRequestContext()
  const canConfigure = can(ctx, 'forms.template.create')
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)

  // App-level list config (recordConfig.list) seeds columns, default sort, and
  // the default status filter — loaded before parseListParams so the configured
  // default sort applies on first load.
  const [template] = await ctx.db((tx) =>
    tx
      .select({
        id: formTemplates.id,
        name: formTemplates.name,
        description: formTemplates.description,
        status: formTemplates.status,
        allowedRoles: formTemplates.allowedRoles,
        deletedAt: formTemplates.deletedAt,
        recordConfig: formTemplates.recordConfig,
      })
      .from(formTemplates)
      .where(eq(formTemplates.id, id))
      .limit(1),
  )
  if (!template || !canAccessTemplate(ctx, template, effectiveRoleKeys, 'browse-records')) {
    notFound()
  }
  const canSubmitResponses =
    can(ctx, 'forms.response.create') &&
    canAccessTemplate(ctx, template, effectiveRoleKeys, 'operate')
  const listConfig = ((template.recordConfig as { list?: ListConfig } | null)?.list ??
    {}) as ListConfig
  const defaultSortKey: (typeof SORTS)[number] =
    listConfig.defaultSort && (SORTS as readonly string[]).includes(listConfig.defaultSort.key)
      ? (listConfig.defaultSort.key as (typeof SORTS)[number])
      : 'submitted_at'
  const listParams = parseListParams(sp, {
    sort: defaultSortKey,
    dir: listConfig.defaultSort?.dir ?? 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const searchQuery = listParams.q?.trim()
  // Default status filter applies on first load (no explicit ?status= param).
  const requestedStatus =
    sp.status !== undefined ? pickString(sp.status) : listConfig.defaultStatus || undefined
  const statusFilter = STATUS_OPTIONS.some((option) => option.value === requestedStatus)
    ? (requestedStatus as (typeof formResponses.$inferSelect)['status'])
    : undefined
  const defaultStatusFilter = STATUS_OPTIONS.some(
    (option) => option.value === listConfig.defaultStatus,
  )
    ? listConfig.defaultStatus
    : undefined

  const result = await ctx.db(async (tx) => {
    const [ver] = await tx
      .select({ schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, id))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)

    // Per-user record visibility (same tiers as apps/responses/page.tsx):
    // read.all → all; read.site → my sites; else → ones I submitted or am the
    // subject of. Without this the per-app list leaks every response's
    // subject/site/fields regardless of the caller's read tier.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'forms.response',
      ownerCols: [formResponses.submittedBy],
      personCol: formResponses.subjectPersonId,
      siteCol: formResponses.siteOrgUnitId,
    })
    const filters: SQL<unknown>[] = [
      eq(formResponses.templateId, id),
      isNull(formResponses.deletedAt),
    ]
    if (vis) filters.push(vis)
    if (statusFilter) filters.push(eq(formResponses.status, statusFilter))
    if (searchQuery) {
      const term = `%${searchQuery}%`
      filters.push(
        sql`concat_ws(' ', ${formResponses.id}::text, coalesce(${people.firstName}, ''), coalesce(${people.lastName}, ''), coalesce(${orgUnits.name}, ''), coalesce(${user.name}, '')) ilike ${term}`,
      )
    }
    const whereClause = and(...filters)

    const orderBy =
      listParams.sort === 'status'
        ? [listParams.dir === 'asc' ? asc(formResponses.status) : desc(formResponses.status)]
        : listParams.sort === 'created_at'
          ? [
              listParams.dir === 'asc'
                ? asc(formResponses.createdAt)
                : desc(formResponses.createdAt),
            ]
          : [
              listParams.dir === 'asc'
                ? asc(formResponses.submittedAt)
                : desc(formResponses.submittedAt),
            ]

    const [tot] = await tx
      .select({ c: count() })
      .from(formResponses)
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponses.submittedBy))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(people, eq(people.id, formResponses.subjectPersonId))
      .where(whereClause)
    const total = Number(tot?.c ?? 0)
    const page = Math.min(listParams.page, Math.max(1, Math.ceil(total / listParams.perPage)))
    const data = await tx
      .select({
        response: formResponses,
        site: orgUnits,
        submittedByName: user.name,
        subjectFirst: people.firstName,
        subjectLast: people.lastName,
      })
      .from(formResponses)
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponses.submittedBy))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(people, eq(people.id, formResponses.subjectPersonId))
      .where(whereClause)
      .orderBy(...orderBy, asc(formResponses.id))
      .limit(listParams.perPage)
      .offset((page - 1) * listParams.perPage)
    const ss = await tx
      .select({ s: formResponses.status, c: count() })
      .from(formResponses)
      .where(and(eq(formResponses.templateId, id), isNull(formResponses.deletedAt), vis))
      .groupBy(formResponses.status)
    return {
      schema: ver?.schema ?? null,
      rows: data,
      total,
      page,
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  const { schema, rows, total, page, statusCounts } = result
  const tmpl = template
  const basePath = `/apps/templates/${id}/records`
  const sortProps = { basePath, currentParams: sp, dir: listParams.dir }

  // "New entry" creates a draft and opens the unified record page directly. A
  // server action (not a Link) so a prefetch can never create stray drafts.
  async function createEntry() {
    'use server'
    const res = await createDraftResponse({ templateId: id })
    if (res.ok) redirect(`/apps/responses/${res.responseId}`)
  }

  const newEntryButton = canSubmitResponses ? (
    <form action={createEntry}>
      <Button type="submit">
        <Plus size={14} /> <GeneratedText id="m_0036397741744c" />
      </Button>
    </form>
  ) : null

  // Resolve display columns from config; index app fields by id for headers + cells.
  const columns =
    listConfig.columns && listConfig.columns.length > 0 ? listConfig.columns : DEFAULT_COLUMNS
  const fieldMap = new Map<string, SchemaField>()
  if (schema) {
    for (const sec of schema.sections) {
      for (const f of sec.fields) fieldMap.set(f.id, f as SchemaField)
    }
  }
  const colLabel = (col: ListColumnConfig) =>
    col.label ??
    (col.source === 'builtin'
      ? (BUILTIN_LABEL[col.key] ?? col.key)
      : localizeText(fieldMap.get(col.key)?.label, ctx.locale, col.key, ctx.defaultLocale))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGeneratedValue(tmpl.name)}
            description={tGeneratedValue(tmpl.description ?? tGenerated('m_1594ebe51f1acc'))}
            actions={
              <>
                <GeneratedValue
                  value={
                    canConfigure ? (
                      <Link href={`/apps/templates/${id}/designer`}>
                        <Button variant="outline">
                          <Settings2 size={14} /> <GeneratedText id="m_01ffac03eed326" />
                        </Button>
                      </Link>
                    ) : null
                  }
                />
                <GeneratedValue value={newEntryButton} />
              </>
            }
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0de8033c150436')} />
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              defaultValue={defaultStatusFilter}
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={32} />}
              title={tGeneratedValue(
                statusFilter || searchQuery
                  ? tGenerated('m_0cbf7aa824c49c')
                  : tGenerated('m_1446c8e422e381'),
              )}
              description={tGeneratedValue(
                statusFilter || searchQuery
                  ? tGenerated('m_1f90cb0675ecc6')
                  : tGenerated('m_1c68804ba22aa2'),
              )}
              action={newEntryButton}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <GeneratedValue
                      value={columns.map((col) =>
                        col.source === 'builtin' && SORTABLE_BUILTINS.has(col.key) ? (
                          <SortableTh
                            key={col.key}
                            {...sortProps}
                            column={col.key}
                            active={listParams.sort === col.key}
                          >
                            <GeneratedValue value={colLabel(col)} />
                          </SortableTh>
                        ) : (
                          <TableHead
                            key={col.key}
                            className={col.key === 'pdf' ? 'w-16' : undefined}
                          >
                            <GeneratedValue value={colLabel(col)} />
                          </TableHead>
                        ),
                      )}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(
                      ({ response, site, submittedByName, subjectFirst, subjectLast }) => {
                        const subject =
                          subjectFirst || subjectLast
                            ? `${subjectLast ?? ''}${subjectLast ? ', ' : ''}${subjectFirst ?? ''}`.trim()
                            : null
                        const data = (response.data as Record<string, unknown> | null) ?? {}
                        const cell = (col: ListColumnConfig) => {
                          if (col.source === 'field') {
                            return (
                              <span className="text-xs text-slate-600">
                                <GeneratedValue
                                  value={formatListCell(
                                    fieldMap.get(col.key),
                                    data[col.key],
                                    ctx.locale,
                                    ctx.defaultLocale,
                                  )}
                                />
                              </span>
                            )
                          }
                          switch (col.key) {
                            case 'id':
                              return (
                                <Link
                                  href={`/apps/responses/${response.id}`}
                                  className="font-mono text-xs hover:underline"
                                >
                                  <GeneratedValue value={response.id.slice(0, 8)} />
                                </Link>
                              )
                            case 'subject':
                              return (
                                <span className="text-xs text-slate-600">
                                  <GeneratedValue
                                    value={subject || <span className="text-slate-400">—</span>}
                                  />
                                </span>
                              )
                            case 'site':
                              return (
                                <span className="text-xs text-slate-600">
                                  <GeneratedValue value={site?.name ?? '—'} />
                                </span>
                              )
                            case 'status':
                              return (
                                <Badge
                                  variant={
                                    response.status === 'closed' || response.status === 'submitted'
                                      ? 'success'
                                      : response.status === 'rejected' ||
                                          response.status === 'non_compliant'
                                        ? 'destructive'
                                        : 'warning'
                                  }
                                >
                                  <GeneratedValue value={response.status.replace('_', ' ')} />
                                </Badge>
                              )
                            case 'created_at':
                              return (
                                <span className="text-xs text-slate-600 tabular-nums">
                                  <GeneratedValue
                                    value={
                                      response.createdAt
                                        ? formatDate(
                                            new Date(response.createdAt),
                                            ctx.timezone,
                                            ctx.locale,
                                          )
                                        : '—'
                                    }
                                  />
                                </span>
                              )
                            case 'submitted_at':
                              return (
                                <span className="text-xs text-slate-600 tabular-nums">
                                  <GeneratedValue
                                    value={
                                      response.submittedAt
                                        ? formatDate(
                                            new Date(response.submittedAt),
                                            ctx.timezone,
                                            ctx.locale,
                                          )
                                        : '—'
                                    }
                                  />
                                </span>
                              )
                            case 'submittedBy':
                              return (
                                <span className="text-xs text-slate-600">
                                  <GeneratedValue
                                    value={
                                      submittedByName ?? <span className="text-slate-400">—</span>
                                    }
                                  />
                                </span>
                              )
                            case 'pdf':
                              return response.pdfAttachmentId ? (
                                <Badge variant="success" className="text-[10px]">
                                  <GeneratedText id="m_1a2b2ed6729166" />
                                </Badge>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )
                            default:
                              return <span className="text-slate-400">—</span>
                          }
                        }
                        return (
                          <TableRow key={response.id}>
                            <GeneratedValue
                              value={columns.map((col) => (
                                <TableCell key={col.key}>
                                  <GeneratedValue value={cell(col)} />
                                </TableCell>
                              ))}
                            />
                          </TableRow>
                        )
                      },
                    )}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath={basePath}
                currentParams={sp}
                total={total}
                page={page}
                perPage={listParams.perPage}
              />
            </>
          )
        }
      />
    </ListPageLayout>
  )
}
