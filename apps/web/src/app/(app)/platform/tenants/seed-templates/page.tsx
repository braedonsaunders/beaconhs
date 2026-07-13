// One-time backfill page for the built-in lift-plan template.
//
// Existing tenants (provisioned before the lift-plan cutover landed) don't
// have the lift-plan form template seeded. Super-admins use this page to fill
// the gap. The seeder is idempotent, so re-clicking is safe.
//
// Once every tenant has been backfilled, this page can be archived — but it
// stays cheap to keep around for new built-in templates we ship later.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import { formTemplates, tenants } from '@beaconhs/db/schema'
import {
  LIFT_PLAN_TEMPLATE_KEY,
  LIFT_PLAN_TEMPLATE_NAME,
  seedLiftPlanTemplate,
} from '@beaconhs/db/seed/lift-plan-template'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'

export const metadata = { title: 'Seed built-in templates' }
export const dynamic = 'force-dynamic'

const BASE = '/platform/tenants/seed-templates'
const SORTS = ['tenant', 'slug', 'status'] as const

async function seedOne(formData: FormData): Promise<void> {
  'use server'
  // POST endpoint not covered by the /platform layout gate — re-check; this
  // bypasses RLS to write into an arbitrary tenant.
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin) throw new Error('Only platform super-admins can seed templates.')
  const tenantId = String(formData.get('tenantId') ?? '').trim()
  if (!tenantId) return

  await withSuperAdmin(db, async (tx) => {
    await seedLiftPlanTemplate(tx as any, tenantId)
  })
  revalidatePath('/platform/tenants/seed-templates')
}

async function seedAll(): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin) throw new Error('Only platform super-admins can seed templates.')

  await withSuperAdmin(db, async (tx) => {
    const all = await tx.select({ id: tenants.id }).from(tenants)
    for (const t of all) {
      await seedLiftPlanTemplate(tx as any, t.id)
    }
  })
  revalidatePath('/platform/tenants/seed-templates')
}

export default async function SeedTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin) redirect('/admin')
  const sp = await searchParams
  const stateParam = pickString(sp.state)
  const stateFilter = stateParam === 'seeded' || stateParam === 'missing' ? stateParam : undefined
  const params = parseListParams(sp, {
    sort: 'tenant',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })

  // Pull each tenant + whether the lift-plan template is already present.
  // The LEFT JOIN keeps tenants that have zero templates in the list (so
  // they're surfaced for backfill rather than silently dropped).
  const { rows, total, missingCount, seededCount, globalMissingCount } = await withSuperAdmin(
    db,
    async (tx) => {
      const search: SQL<unknown> | undefined = params.q
        ? or(ilike(tenants.name, `%${params.q}%`), ilike(tenants.slug, `%${params.q}%`))
        : undefined
      const state =
        stateFilter === 'seeded'
          ? isNotNull(formTemplates.id)
          : stateFilter === 'missing'
            ? isNull(formTemplates.id)
            : undefined
      const join = and(
        eq(formTemplates.tenantId, tenants.id),
        eq(formTemplates.key, LIFT_PLAN_TEMPLATE_KEY),
        isNull(formTemplates.deletedAt),
      )
      const dirFn = params.dir === 'asc' ? asc : desc
      const orderBy =
        params.sort === 'slug'
          ? [dirFn(tenants.slug)]
          : params.sort === 'status'
            ? [dirFn(formTemplates.id), asc(tenants.name)]
            : [dirFn(tenants.name)]

      const baseCount = () => tx.select({ c: count() }).from(tenants).leftJoin(formTemplates, join)
      const [totalRow, missingRow, seededRow, globalMissingRow, result] = await Promise.all([
        baseCount().where(and(search, state)),
        baseCount().where(and(search, isNull(formTemplates.id))),
        baseCount().where(and(search, isNotNull(formTemplates.id))),
        baseCount().where(isNull(formTemplates.id)),
        tx
          .select({ tenant: tenants, liftPlanTemplateId: formTemplates.id })
          .from(tenants)
          .leftJoin(formTemplates, join)
          .where(and(search, state))
          .orderBy(...orderBy)
          .limit(params.perPage)
          .offset((params.page - 1) * params.perPage),
      ])
      return {
        rows: result,
        total: Number(totalRow[0]?.c ?? 0),
        missingCount: Number(missingRow[0]?.c ?? 0),
        seededCount: Number(seededRow[0]?.c ?? 0),
        globalMissingCount: Number(globalMissingRow[0]?.c ?? 0),
      }
    },
  )

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/platform/tenants', label: 'Back to tenants' }}
          title="Seed built-in templates"
          subtitle="Backfill per-tenant form templates that ship as built-ins. Idempotent — re-running is a no-op."
          actions={
            <form action={seedAll}>
              <Button type="submit" disabled={globalMissingCount === 0}>
                Seed all missing ({globalMissingCount})
              </Button>
            </form>
          }
        />

        <Alert variant="info">
          <AlertTitle>{LIFT_PLAN_TEMPLATE_NAME}</AlertTitle>
          <AlertDescription>
            Per-tenant form template with category <code>lift_plan</code>. Surfaces in the form
            gallery at{' '}
            <Link
              href="/apps?category=lift_plan"
              className="font-medium text-teal-700 hover:underline"
            >
              /apps?category=lift_plan
            </Link>
            .
          </AlertDescription>
        </Alert>

        <TableToolbar>
          <SearchInput placeholder="Search tenant or slug…" />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="state"
            label="Template"
            options={[
              { value: 'seeded', label: 'Seeded', count: seededCount },
              { value: 'missing', label: 'Missing', count: missingCount },
            ]}
          />
        </TableToolbar>

        {rows.length === 0 ? (
          <EmptyState title="No tenants match the search or template filter" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="tenant"
                  active={params.sort === 'tenant'}
                >
                  Tenant
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="slug"
                  active={params.sort === 'slug'}
                >
                  Slug
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="status"
                  active={params.sort === 'status'}
                >
                  {LIFT_PLAN_TEMPLATE_NAME}
                </SortableTh>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ tenant, liftPlanTemplateId }) => {
                const seeded = !!liftPlanTemplateId
                return (
                  <TableRow key={tenant.id}>
                    <TableCell className="font-medium">{tenant.name}</TableCell>
                    <TableCell className="font-mono text-xs">{tenant.slug}</TableCell>
                    <TableCell>
                      {seeded ? (
                        <Badge variant="success">Seeded</Badge>
                      ) : (
                        <Badge variant="warning">Missing</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <form action={seedOne}>
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <Button type="submit" size="sm" variant="outline" disabled={seeded}>
                          {seeded ? 'Already seeded' : 'Seed lift-plan template'}
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        <Pagination
          basePath={BASE}
          currentParams={sp}
          total={total}
          page={params.page}
          perPage={params.perPage}
        />
      </div>
    </PageContainer>
  )
}
