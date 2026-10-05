import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { and, asc, count, desc, eq, ilike, or, sql, type AnyColumn } from 'drizzle-orm'
import {
  orgUnits,
  ppeInspections,
  ppeItems,
  ppeTypes,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import {
  Badge,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { PpeSubNav } from '@/components/ppe-sub-nav'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { DownloadLink } from '@/components/download-link'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1219871c3f3a8f') }
}
const BASE = '/ppe/inspections'
const SORTS = ['date', 'item', 'kind', 'result', 'status'] as const
const KINDS = ['pre_use', 'annual'] as const
const RESULTS = ['pass', 'fail', 'n_a'] as const
const STATUSES = ['in_progress', 'submitted'] as const
const LABELS: Record<string, string> = {
  pre_use: 'Pre-use',
  annual: 'Annual',
  pass: 'Pass',
  fail: 'Fail',
  n_a: 'N/A',
  in_progress: 'In progress',
  submitted: 'Submitted',
}
const label = (value: string) => LABELS[value] ?? value

export default async function PpeInspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.manage')
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'date',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const kind = KINDS.find((value) => value === pickString(sp.kind))
  const result = RESULTS.find((value) => value === pickString(sp.result))
  const status = STATUSES.find((value) => value === pickString(sp.status))
  const inspector = sql<string>`coalesce(${ppeInspections.inspectorNameSnapshot}, ${users.name}, '')`
  const term = `%${params.q}%`
  const where = and(
    eq(ppeInspections.tenantId, ctx.tenantId),
    kind ? eq(ppeInspections.kind, kind) : undefined,
    result ? eq(ppeInspections.result, result) : undefined,
    status ? eq(ppeInspections.status, status) : undefined,
    params.q
      ? or(
          ilike(ppeItems.serialNumber, term),
          ilike(ppeTypes.name, term),
          ilike(inspector, term),
          ilike(orgUnits.name, term),
          ilike(ppeInspections.notes, term),
        )
      : undefined,
  )
  const sortColumns: Record<(typeof SORTS)[number], AnyColumn> = {
    date: ppeInspections.inspectedOn,
    item: ppeTypes.name,
    kind: ppeInspections.kind,
    result: ppeInspections.result,
    status: ppeInspections.status,
  }
  const { rows, total } = await ctx.db(async (tx) => {
    const query = tx
      .select({
        inspection: ppeInspections,
        serial: ppeItems.serialNumber,
        type: ppeTypes.name,
        inspector,
        site: orgUnits.name,
      })
      .from(ppeInspections)
      .innerJoin(ppeItems, eq(ppeItems.id, ppeInspections.itemId))
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, ppeInspections.inspectedByTenantUserId))
      .leftJoin(users, eq(users.id, tenantUsers.userId))
      .leftJoin(orgUnits, eq(orgUnits.id, ppeInspections.siteOrgUnitId))
      .where(where)
    const [tot] = await tx.select({ n: count() }).from(query.as('filtered_inspections'))
    const rows = await query
      .orderBy(
        params.dir === 'asc' ? asc(sortColumns[params.sort]) : desc(sortColumns[params.sort]),
        desc(ppeInspections.createdAt),
        desc(ppeInspections.id),
      )
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return { rows, total: Number(tot?.n ?? 0) }
  })
  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_1219871c3f3a8f')}
            description={tGenerated('m_188bba91bd3aac', { value0: total.toLocaleString() })}
          />
          <PpeSubNav active="inspections" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_03945ee3d559c0')} />
            {(
              [
                ['kind', kind, KINDS, 'All kinds'],
                ['result', result, RESULTS, 'All results'],
                ['status', status, STATUSES, 'All statuses'],
              ] as const
            ).map(([key, selected, options, all]) => (
              <div key={key} className="flex flex-wrap gap-1" role="group" aria-label={key}>
                {[['', all], ...options.map((value) => [value, label(value)])].map(
                  ([value, text]) => (
                    <Link
                      key={value}
                      href={mergeHref(BASE, sp, { [key]: value || undefined, page: 1 })}
                      aria-current={(selected ?? '') === value ? 'page' : undefined}
                      className={
                        (selected ?? '') === value
                          ? 'rounded-full bg-teal-600 px-3 py-1 text-xs text-white'
                          : 'rounded-full border border-slate-200 px-3 py-1 text-xs capitalize dark:border-slate-700'
                      }
                    >
                      <GeneratedValue value={text} />
                    </Link>
                  ),
                )}
              </div>
            ))}
          </TableToolbar>
        </>
      }
    >
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <Table>
          <TableHeader>
            <TableRow>
              {(
                [
                  ['date', 'Date'],
                  ['item', 'PPE item'],
                  ['kind', 'Kind'],
                ] as const
              ).map(([column, text]) => (
                <SortableTh
                  key={column}
                  {...sortProps}
                  column={column}
                  active={params.sort === column}
                >
                  <GeneratedValue value={text} />
                </SortableTh>
              ))}
              <TableHead>
                <GeneratedText id="m_08412ea75fe5da" />
              </TableHead>
              <TableHead>
                <GeneratedText id="m_055f11420b2da4" />
              </TableHead>
              {(
                [
                  ['result', 'Result'],
                  ['status', 'Status'],
                ] as const
              ).map(([column, text]) => (
                <SortableTh
                  key={column}
                  {...sortProps}
                  column={column}
                  active={params.sort === column}
                >
                  <GeneratedValue value={text} />
                </SortableTh>
              ))}
              <TableHead>
                <GeneratedText id="m_0a7f1858f2ec46" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-slate-500">
                  <GeneratedText id="m_15791aa62fdffb" />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.inspection.id}>
                  <TableCell className="whitespace-nowrap">
                    {row.inspection.inspectedOn ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Link
                      className="text-teal-700 hover:underline dark:text-teal-400"
                      href={`/ppe/${row.inspection.itemId}?tab=inspections&drawer=inspection&inspectionId=${row.inspection.id}`}
                    >
                      {row.type}
                      {row.serial ? ` · ${row.serial}` : ''}
                    </Link>
                  </TableCell>
                  <TableCell className="capitalize">
                    <GeneratedValue value={label(row.inspection.kind)} />
                  </TableCell>
                  <TableCell>{row.inspector || '—'}</TableCell>
                  <TableCell>{row.site || '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.inspection.result === 'pass'
                          ? 'success'
                          : row.inspection.result === 'fail'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      <GeneratedValue
                        value={row.inspection.result ? label(row.inspection.result) : '—'}
                      />
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">
                    <GeneratedValue value={label(row.inspection.status)} />
                  </TableCell>
                  <TableCell>
                    <DownloadLink
                      className="text-teal-700 hover:underline dark:text-teal-400"
                      href={`/ppe/${row.inspection.itemId}/inspections/${row.inspection.id}/pdf`}
                      target="_blank"
                    >
                      <GeneratedText id="m_1a2b2ed6729166" />
                    </DownloadLink>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}
