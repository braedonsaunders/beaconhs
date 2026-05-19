import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { formResponses, formTemplates, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'Inspections' }

const SORTS = ['submitted_at', 'template', 'status'] as const

// Inspections in BeaconHS = form_responses against templates with category='inspection'
// (legacy: a dedicated Inspections module; new: same surface but built on the form builder)

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_review', label: 'In review' },
  { value: 'closed', label: 'Closed' },
]

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'submitted_at', dir: 'desc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, templates } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [eq(formTemplates.category, 'inspection')]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = ilike(formTemplates.name, term)
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(formResponses.status, statusFilter as any))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'template'
        ? [params.dir === 'asc' ? asc(formTemplates.name) : desc(formTemplates.name)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(formResponses.status) : desc(formResponses.status)]
          : [params.dir === 'asc' ? asc(formResponses.submittedAt) : desc(formResponses.submittedAt)]

    const [tot] = await tx
      .select({ c: count() })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .where(whereClause)
    const data = await tx
      .select({ response: formResponses, template: formTemplates, site: orgUnits })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const ss = await tx
      .select({ s: formResponses.status, c: count() })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .where(eq(formTemplates.category, 'inspection'))
      .groupBy(formResponses.status)
    const tmpls = await tx
      .select({ id: formTemplates.id, name: formTemplates.name, status: formTemplates.status })
      .from(formTemplates)
      .where(eq(formTemplates.category, 'inspection'))
      .orderBy(asc(formTemplates.name))
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      templates: tmpls,
    }
  })

  const sortProps = { basePath: '/inspections', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Inspections"
            description="Pass/fail/N/A criteria, comments, photos, customer signature. Each inspection type is a form template."
            actions={
              <div className="flex items-center gap-2">
                <Link href={buildExportHref('/inspections/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                {templates.length > 0 ? (
                  <Link href={`/forms/templates/${templates[0]!.id}/fill`}>
                    <Button>New inspection</Button>
                  </Link>
                ) : (
                  <Link href="/forms/templates/new?category=inspection">
                    <Button>Create inspection template</Button>
                  </Link>
                )}
              </div>
            }
          />
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/inspections"
              className="rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700"
            >
              Recent inspections
            </Link>
            <Link
              href="/forms?category=inspection"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Templates
            </Link>
            <Link
              href="/inspections/banks"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Inspection banks
            </Link>
          </nav>
        </>
      }
    >
      {templates.length === 0 ? (
        <Alert variant="info">
          <AlertTitle>No inspection templates yet</AlertTitle>
          <AlertDescription>
            Inspections are configurable form templates with the category{' '}
            <code className="font-mono">inspection</code>. Create your first template to get
            started.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Available inspection types ({templates.length})</h3>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <Link
                key={t.id}
                href={`/forms/templates/${t.id}/fill`}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:border-teal-500 hover:bg-teal-50"
              >
                {t.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <SearchInput placeholder="Search by template name" />
      </div>
      <FilterChips
        basePath="/inspections"
        currentParams={sp}
        paramKey="status"
        label="Status"
        options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title="No inspections yet"
          description="Pick an inspection type above to record one."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <SortableTh {...sortProps} column="template" active={params.sort === 'template'}>Type</SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>Status</SortableTh>
                <SortableTh {...sortProps} column="submitted_at" active={params.sort === 'submitted_at'}>Submitted</SortableTh>
                <TableHead>Site</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ response, template, site }) => (
                <TableRow key={response.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/forms/responses/${response.id}`} className="hover:underline">
                      {response.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/forms/responses/${response.id}`} className="font-medium text-slate-900 hover:underline">
                      {template.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={response.status === 'closed' || response.status === 'submitted' ? 'success' : 'warning'}>
                      {response.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {response.submittedAt ? new Date(response.submittedAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/inspections"
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
