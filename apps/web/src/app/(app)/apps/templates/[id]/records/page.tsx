// Per-app records list — the "home" of a Builder app when pinned to the
// sidebar. Behaves like a native module: a list of entries (form responses)
// for THIS template, each row opening the entry's view page
// (/apps/responses/[id]). New entries are created via the filler; editors get
// a "Configure" link into the designer. Uses the same shared native list
// chrome (ListPageLayout / PageHeader / Table / SortableTh / Pagination) as
// every other records page.

import Link from 'next/link'
import { notFound } from 'next/navigation'
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
  formTemplates,
  orgUnits,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
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
  const listParams = parseListParams(sp, {
    sort: 'submitted_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()
  const canConfigure = can(ctx, 'forms.template.create')

  const result = await ctx.db(async (tx) => {
    const [tmpl] = await tx
      .select({
        id: formTemplates.id,
        name: formTemplates.name,
        description: formTemplates.description,
      })
      .from(formTemplates)
      .where(eq(formTemplates.id, id))
      .limit(1)
    if (!tmpl) return null

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
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  if (!result) notFound()
  const { tmpl, rows, total, statusCounts } = result
  const basePath = `/apps/templates/${id}/records`
  const newHref = `/apps/templates/${id}/fill`
  const sortProps = { basePath, currentParams: sp, dir: listParams.dir }

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
                <Link href={newHref}>
                  <Button>
                    <Plus size={14} /> New entry
                  </Button>
                </Link>
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
          action={
            <Link href={newHref}>
              <Button>New entry</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Site</TableHead>
                <SortableTh {...sortProps} column="status" active={listParams.sort === 'status'}>
                  Status
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="created_at"
                  active={listParams.sort === 'created_at'}
                >
                  Started
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="submitted_at"
                  active={listParams.sort === 'submitted_at'}
                >
                  Submitted
                </SortableTh>
                <TableHead>By</TableHead>
                <TableHead className="w-16">PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ response, site, submittedByName, subjectFirst, subjectLast }) => {
                const subject =
                  subjectFirst || subjectLast
                    ? `${subjectLast ?? ''}${subjectLast ? ', ' : ''}${subjectFirst ?? ''}`.trim()
                    : null
                return (
                  <TableRow key={response.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/apps/templates/${id}/fill?responseId=${response.id}`}
                        className="hover:underline"
                      >
                        {response.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {subject || <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">{site?.name ?? '—'}</TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 tabular-nums">
                      {response.createdAt ? new Date(response.createdAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 tabular-nums">
                      {response.submittedAt
                        ? new Date(response.submittedAt).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {submittedByName ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell>
                      {response.pdfAttachmentId ? (
                        <Badge variant="success" className="text-[10px]">
                          PDF
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
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
