// Per-app records list — the "home" of a Builder app when pinned to the
// sidebar. Behaves like a native module: a list of entries (form responses)
// for THIS template, each row opening the entry's record page
// (/apps/responses/[id]). Columns, default sort and the default status filter
// are app-configurable via recordConfig.list (designer → List tab). New entries
// are created via the filler (guided) or a draft + record page (inline). Uses
// the shared native list chrome (ListPageLayout / PageHeader / Table / etc.).

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ClipboardCheck, Plus, Settings2 } from 'lucide-react'
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm'
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
import {
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { createDraftResponse } from '@/app/(app)/apps/templates/[id]/fill/actions'
import { parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'

export const dynamic = 'force-dynamic'

const SORTS = ['submitted_at', 'created_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
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
  label?: { en?: string }
  type?: string
  validation?: { options?: { value: string; label?: { en?: string } }[] }
}

// Lightweight cell formatter for app-field columns (scalars / selects / arrays).
function formatListCell(field: SchemaField | undefined, raw: unknown): string {
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
    if (match) return match.label?.en ?? String(raw)
  }
  return String(raw)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const [tmpl] = await ctx.db((tx) =>
    tx
      .select({ name: formTemplates.name })
      .from(formTemplates)
      .where(eq(formTemplates.id, id))
      .limit(1),
  )
  return { title: tmpl?.name ?? 'App records' }
}

export default async function AppRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireRequestContext()
  const canConfigure = can(ctx, 'forms.template.create')

  // App-level list config (recordConfig.list) seeds columns, default sort, and
  // the default status filter — loaded before parseListParams so the configured
  // default sort applies on first load.
  const [cfgRow] = await ctx.db((tx) =>
    tx
      .select({ recordConfig: formTemplates.recordConfig })
      .from(formTemplates)
      .where(eq(formTemplates.id, id))
      .limit(1),
  )
  const listConfig = ((cfgRow?.recordConfig as { list?: ListConfig } | null)?.list ??
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
  // Default status filter applies on first load (no explicit ?status= param).
  const statusFilter =
    sp.status !== undefined ? pickString(sp.status) : listConfig.defaultStatus || undefined

  const result = await ctx.db(async (tx) => {
    const [tmpl] = await tx
      .select({
        id: formTemplates.id,
        name: formTemplates.name,
        description: formTemplates.description,
        kind: formTemplates.kind,
        recordConfig: formTemplates.recordConfig,
      })
      .from(formTemplates)
      .where(eq(formTemplates.id, id))
      .limit(1)
    if (!tmpl) return null

    const [ver] = await tx
      .select({ schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, id))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)

    const filters: SQL<unknown>[] = [eq(formResponses.templateId, id)]
    if (statusFilter) filters.push(eq(formResponses.status, statusFilter as never))
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

    const [tot] = await tx.select({ c: count() }).from(formResponses).where(whereClause)
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
      .orderBy(...orderBy)
      .limit(listParams.perPage)
      .offset((listParams.page - 1) * listParams.perPage)
    const ss = await tx
      .select({ s: formResponses.status, c: count() })
      .from(formResponses)
      .where(eq(formResponses.templateId, id))
      .groupBy(formResponses.status)
    return {
      tmpl,
      schema: ver?.schema ?? null,
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  if (!result) notFound()
  const { tmpl, schema, rows, total, statusCounts } = result
  const basePath = `/apps/templates/${id}/records`
  const newHref = `/apps/templates/${id}/fill`
  const sortProps = { basePath, currentParams: sp, dir: listParams.dir }

  const recordConfig = tmpl.recordConfig as {
    editingMode?: 'guided_fill' | 'inline_record' | 'both'
  } | null
  const editingMode =
    recordConfig?.editingMode ??
    (tmpl.kind !== 'wizard' && tmpl.kind !== 'checklist' ? 'inline_record' : 'guided_fill')
  const inlineApp = editingMode !== 'guided_fill'

  // Inline apps have no wizard: "New entry" creates a draft and opens the unified
  // record page directly. A server action (not a Link) so a prefetch can never
  // create stray drafts. Guided-fill apps still start in the wizard.
  async function createEntry() {
    'use server'
    const res = await createDraftResponse({ templateId: id })
    if (res.ok) redirect(`/apps/responses/${res.responseId}`)
  }

  const newEntryButton = inlineApp ? (
    <form action={createEntry}>
      <Button type="submit">
        <Plus size={14} /> New entry
      </Button>
    </form>
  ) : (
    <Link href={newHref}>
      <Button>
        <Plus size={14} /> New entry
      </Button>
    </Link>
  )

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
      : (fieldMap.get(col.key)?.label?.en ?? col.key))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tmpl.name}
            description={tmpl.description ?? 'Entries for this app.'}
            actions={
              <>
                {canConfigure ? (
                  <Link href={`/apps/templates/${id}/designer`}>
                    <Button variant="outline">
                      <Settings2 size={14} /> Configure
                    </Button>
                  </Link>
                ) : null}
                {newEntryButton}
              </>
            }
          />
          <TableToolbar>
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title={statusFilter ? 'No entries match this filter' : 'No entries yet'}
          description="Create the first entry for this app."
          action={newEntryButton}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) =>
                  col.source === 'builtin' && SORTABLE_BUILTINS.has(col.key) ? (
                    <SortableTh
                      key={col.key}
                      {...sortProps}
                      column={col.key}
                      active={listParams.sort === col.key}
                    >
                      {colLabel(col)}
                    </SortableTh>
                  ) : (
                    <TableHead key={col.key} className={col.key === 'pdf' ? 'w-16' : undefined}>
                      {colLabel(col)}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ response, site, submittedByName, subjectFirst, subjectLast }) => {
                const subject =
                  subjectFirst || subjectLast
                    ? `${subjectLast ?? ''}${subjectLast ? ', ' : ''}${subjectFirst ?? ''}`.trim()
                    : null
                const data = (response.data as Record<string, unknown> | null) ?? {}
                const cell = (col: ListColumnConfig) => {
                  if (col.source === 'field') {
                    return (
                      <span className="text-xs text-slate-600">
                        {formatListCell(fieldMap.get(col.key), data[col.key])}
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
                          {response.id.slice(0, 8)}
                        </Link>
                      )
                    case 'subject':
                      return (
                        <span className="text-xs text-slate-600">
                          {subject || <span className="text-slate-400">—</span>}
                        </span>
                      )
                    case 'site':
                      return <span className="text-xs text-slate-600">{site?.name ?? '—'}</span>
                    case 'status':
                      return (
                        <Badge
                          variant={
                            response.status === 'closed' || response.status === 'submitted'
                              ? 'success'
                              : response.status === 'rejected'
                                ? 'destructive'
                                : 'warning'
                          }
                        >
                          {response.status.replace('_', ' ')}
                        </Badge>
                      )
                    case 'created_at':
                      return (
                        <span className="text-xs text-slate-600 tabular-nums">
                          {response.createdAt
                            ? new Date(response.createdAt).toLocaleDateString()
                            : '—'}
                        </span>
                      )
                    case 'submitted_at':
                      return (
                        <span className="text-xs text-slate-600 tabular-nums">
                          {response.submittedAt
                            ? new Date(response.submittedAt).toLocaleDateString()
                            : '—'}
                        </span>
                      )
                    case 'submittedBy':
                      return (
                        <span className="text-xs text-slate-600">
                          {submittedByName ?? <span className="text-slate-400">—</span>}
                        </span>
                      )
                    case 'pdf':
                      return response.pdfAttachmentId ? (
                        <Badge variant="success" className="text-[10px]">
                          PDF
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
                    {columns.map((col) => (
                      <TableCell key={col.key}>{cell(col)}</TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath={basePath}
            currentParams={sp}
            total={total}
            page={listParams.page}
            perPage={listParams.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
