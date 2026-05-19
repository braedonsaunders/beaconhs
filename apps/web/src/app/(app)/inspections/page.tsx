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

// Inspections in BeaconHS = form_responses against templates with category='inspection'.
// We re-use the same surface for the four canonical module-bound categories
// (jsha / toolbox_talk / lift_plan / wah) — driven by ?bound=… — so users get a
// dedicated landing for the legacy big modules without duplicating the UI.

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_review', label: 'In review' },
  { value: 'closed', label: 'Closed' },
]

// Sub-nav pills mapping a "bound" value to the moduleBinding/category pair to
// filter on. The default ('') is the classic Inspections view.
const MODULE_PILLS = [
  { value: '', label: 'Inspections', moduleBinding: null as string | null, category: 'inspection' },
  { value: 'jsha', label: 'JSHAs', moduleBinding: 'jsha', category: 'jsha' },
  { value: 'toolbox_talk', label: 'Toolbox talks', moduleBinding: 'toolbox_talk', category: 'toolbox_talk' },
  { value: 'lift_plan', label: 'Lift plans', moduleBinding: 'lift_plan', category: 'lift_plan' },
  { value: 'wah', label: 'WAH rescue', moduleBinding: 'wah', category: 'wah' },
] as const

function resolveBound(raw: string | undefined): (typeof MODULE_PILLS)[number] {
  const found = MODULE_PILLS.find((p) => p.value === raw)
  return found ?? MODULE_PILLS[0]!
}

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'submitted_at', dir: 'desc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const bound = resolveBound(pickString(sp.bound))
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, templates } = await ctx.db(async (tx) => {
    // When bound is set, prefer moduleBinding for the template filter — that's
    // the canonical signal — but fall back to category so legacy templates
    // (set up before moduleBinding was added) still flow through.
    const templateScope: SQL<unknown> = bound.value
      ? (or(
          eq(formTemplates.moduleBinding, bound.moduleBinding!),
          eq(formTemplates.category, bound.category),
        ) as SQL<unknown>)
      : eq(formTemplates.category, 'inspection')

    const filters: SQL<unknown>[] = [templateScope]
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
      .where(templateScope)
      .groupBy(formResponses.status)
    const tmpls = await tx
      .select({ id: formTemplates.id, name: formTemplates.name, status: formTemplates.status })
      .from(formTemplates)
      .where(templateScope)
      .orderBy(asc(formTemplates.name))
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      templates: tmpls,
    }
  })

  const sortProps = { basePath: '/inspections', currentParams: sp, dir: params.dir }

  // Title / copy adapt to the bound pill so the page feels like a dedicated
  // landing for each of the four legacy big modules.
  const pageTitle = bound.value ? bound.label : 'Inspections'
  const pageDescription = bound.value
    ? `${bound.label} live on the form-template surface — every template tagged with the "${bound.moduleBinding}" module binding shows up here.`
    : 'Pass/fail/N/A criteria, comments, photos, customer signature. Each inspection type is a form template.'

  // "New" CTA links to the right kind of template — bound pages fall back to
  // the canonical gallery filtered by the matching category.
  const newCtaLabel = bound.value ? `New ${bound.label.toLowerCase()}` : 'New inspection'
  const noTemplatesCtaHref = bound.value
    ? `/forms/templates/new?category=${bound.category}`
    : '/forms/templates/new?category=inspection'

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={pageTitle}
            description={pageDescription}
            actions={
              <div className="flex items-center gap-2">
                <Link href={buildExportHref('/inspections/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                {templates.length > 0 ? (
                  <Link href={`/forms/templates/${templates[0]!.id}/fill`}>
                    <Button>{newCtaLabel}</Button>
                  </Link>
                ) : (
                  <Link href={noTemplatesCtaHref as any}>
                    <Button>Create template</Button>
                  </Link>
                )}
              </div>
            }
          />
          <nav className="flex flex-wrap items-center gap-2">
            {MODULE_PILLS.map((pill) => {
              const isActive = pill.value === bound.value
              const href = pill.value ? `/inspections?bound=${pill.value}` : '/inspections'
              return (
                <Link
                  key={pill.value || 'all'}
                  href={href as any}
                  className={
                    isActive
                      ? 'rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700'
                      : 'rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700'
                  }
                >
                  {pill.label}
                </Link>
              )
            })}
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <Link
              href={`/forms?category=${bound.value || 'inspection'}` as any}
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
          <AlertTitle>
            {bound.value ? `No ${bound.label} templates yet` : 'No inspection templates yet'}
          </AlertTitle>
          <AlertDescription>
            {bound.value ? (
              <>
                Tag a template with module binding{' '}
                <code className="font-mono">{bound.moduleBinding}</code> (or category{' '}
                <code className="font-mono">{bound.category}</code>) and it'll show up here.
                The fastest way is to clone the canonical from the{' '}
                <Link
                  href="/forms/templates/new"
                  className="font-medium text-teal-700 hover:underline"
                >
                  template gallery
                </Link>
                .
              </>
            ) : (
              <>
                Inspections are configurable form templates with the category{' '}
                <code className="font-mono">inspection</code>. Create your first template to get
                started.
              </>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">
            Available {bound.value ? `${bound.label.toLowerCase()} ` : 'inspection '}types ({templates.length})
          </h3>
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
          title={bound.value ? `No ${bound.label.toLowerCase()} submitted yet` : 'No inspections yet'}
          description={
            bound.value
              ? `Pick a ${bound.label.toLowerCase()} template above to record one.`
              : 'Pick an inspection type above to record one.'
          }
          action={
            templates.length > 0 ? (
              <Link href={`/forms/templates/${templates[0]!.id}/fill`}>
                <Button>{newCtaLabel}</Button>
              </Link>
            ) : (
              <Link href={noTemplatesCtaHref as any}>
                <Button>Create template</Button>
              </Link>
            )
          }
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
