import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'

export const metadata = { title: 'Form responses' }

const SORTS = ['submitted_at', 'created_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_review', label: 'In review' },
  { value: 'closed', label: 'Closed' },
  { value: 'rejected', label: 'Rejected' },
]

export default async function FormResponsesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'submitted_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  // Optional deep-link filter only: `?category=…` narrows to one template
  // category (e.g. links from other modules). No hardcoded category pivot.
  const categoryFilter = pickString(sp.category)
  // The single most useful scope: pick ONE app/template. Without it this list is
  // one undifferentiated dump of every app's submissions (e.g. thousands of JHSA
  // wizard responses drowning out the rest).
  const templateFilter = pickString(sp.template)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, templateOptions } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (statusFilter) filters.push(eq(formResponses.status, statusFilter as any))
    if (templateFilter) filters.push(eq(formResponses.templateId, templateFilter))
    if (categoryFilter) filters.push(eq(formTemplates.category, categoryFilter))
    if (params.q) {
      const term = `%${params.q}%`
      const cond = ilike(formTemplates.name, term)
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'status'
        ? [params.dir === 'asc' ? asc(formResponses.status) : desc(formResponses.status)]
        : params.sort === 'created_at'
          ? [params.dir === 'asc' ? asc(formResponses.createdAt) : desc(formResponses.createdAt)]
          : [
              params.dir === 'asc'
                ? asc(formResponses.submittedAt)
                : desc(formResponses.submittedAt),
            ]

    const [tot] = await tx
      .select({ c: count() })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .where(whereClause)
    const data = await tx
      .select({
        response: formResponses,
        template: formTemplates,
        site: orgUnits,
        version: formTemplateVersions,
        submittedByName: user.name,
        subjectFirst: people.firstName,
        subjectLast: people.lastName,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .leftJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponses.submittedBy))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(people, eq(people.id, formResponses.subjectPersonId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    // Status chip counts reflect the chosen app (when one is selected).
    const ss = await tx
      .select({ s: formResponses.status, c: count() })
      .from(formResponses)
      .where(templateFilter ? eq(formResponses.templateId, templateFilter) : undefined)
      .groupBy(formResponses.status)
    // App filter options: every template that has at least one response, most-used
    // first so the dominant apps are easy to find.
    const apps = await tx
      .select({ id: formTemplates.id, name: formTemplates.name, c: count(formResponses.id) })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .groupBy(formTemplates.id, formTemplates.name)
      .orderBy(desc(count(formResponses.id)))
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      templateOptions: apps.map((a) => ({ value: a.id, label: a.name, count: Number(a.c) })),
    }
  })

  const sortProps = { basePath: '/forms/responses', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Form responses"
            description="Every app submission. Use the App filter to focus on one."
            actions={
              <Link href={buildExportHref('/forms/responses/export.csv', sp)}>
                <Button variant="outline">Export CSV</Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search app name…" />
            <FilterChips
              basePath="/forms/responses"
              currentParams={sp}
              paramKey="template"
              label="App"
              allLabel="All apps"
              options={templateOptions}
            />
            <FilterChips
              basePath="/forms/responses"
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
          title={
            statusFilter || params.q || categoryFilter || templateFilter
              ? 'No responses match these filters'
              : 'No responses'
          }
          description={
            categoryFilter
              ? `No ${categoryFilter.replace(/_/g, ' ')} responses. Fill out a template to log one.`
              : 'Select a template to fill out a new form.'
          }
          action={
            <Link href="/forms">
              <Button>Browse templates</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Step</TableHead>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="created_at"
                  active={params.sort === 'created_at'}
                >
                  Started
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="submitted_at"
                  active={params.sort === 'submitted_at'}
                >
                  Submitted
                </SortableTh>
                <TableHead>By</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead className="w-16">PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(
                ({
                  response,
                  template,
                  site,
                  version,
                  submittedByName,
                  subjectFirst,
                  subjectLast,
                }) => {
                  const subject =
                    subjectFirst || subjectLast
                      ? `${subjectLast ?? ''}${subjectLast ? ', ' : ''}${subjectFirst ?? ''}`.trim()
                      : null
                  return (
                    <TableRow key={response.id}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/forms/responses/${response.id}`} className="hover:underline">
                          {response.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/forms/responses/${response.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {template.name}
                        </Link>
                        {template.category ? (
                          <div className="text-xs text-slate-500">
                            {template.category.replace(/_/g, ' ')}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 tabular-nums">
                        {version ? `v${version.version}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {subject || <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">{site?.name ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {response.currentStep ? (
                          <Badge variant="outline" className="text-[10px]">
                            {response.currentStep}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            response.status === 'closed' || response.status === 'submitted'
                              ? 'success'
                              : 'warning'
                          }
                        >
                          {response.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 tabular-nums">
                        {response.createdAt
                          ? new Date(response.createdAt).toLocaleDateString()
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 tabular-nums">
                        {response.submittedAt
                          ? new Date(response.submittedAt).toLocaleDateString()
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {submittedByName ?? <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 tabular-nums">
                        {response.closedAt ? new Date(response.closedAt).toLocaleDateString() : '—'}
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
                },
              )}
            </TableBody>
          </Table>
          <Pagination
            basePath="/forms/responses"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
