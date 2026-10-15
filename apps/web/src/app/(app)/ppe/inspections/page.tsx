import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { and, asc, count, desc, eq, ilike, or, sql, type AnyColumn } from 'drizzle-orm'
import { ClipboardCheck } from 'lucide-react'
import {
  orgUnits,
  ppeInspections,
  ppeItems,
  ppeTypes,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import {
  Badge,
  Button,
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
import { FilterChips } from '@/components/filter-bar'
import { PpeInspectionDetailDrawer } from '../_inspection-detail-drawer'
import { PpeOtherInspectionDrawer } from '../_other-inspection-drawer'

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
const SOURCES = ['register', 'other'] as const
const LABELS: Record<string, string> = {
  register: 'Register',
  other: 'Other PPE',
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
  const source = SOURCES.find((value) => value === pickString(sp.source))
  const drawer = pickString(sp.drawer)
  const serial = sql<
    string | null
  >`coalesce(${ppeItems.serialNumber}, ${ppeInspections.serialNumber})`
  const inspector = sql<string>`coalesce(${ppeInspections.inspectorNameSnapshot}, ${users.name}, '')`
  const term = `%${params.q}%`
  const where = and(
    eq(ppeInspections.tenantId, ctx.tenantId),
    kind ? eq(ppeInspections.kind, kind) : undefined,
    result ? eq(ppeInspections.result, result) : undefined,
    status ? eq(ppeInspections.status, status) : undefined,
    source ? eq(ppeInspections.isOther, source === 'other') : undefined,
    params.q
      ? or(
          ilike(ppeItems.serialNumber, term),
          ilike(ppeInspections.serialNumber, term),
          ilike(ppeInspections.suppliedBy, term),
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
        serial,
        type: ppeTypes.name,
        inspector,
        site: orgUnits.name,
      })
      .from(ppeInspections)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeInspections.typeId))
      .leftJoin(ppeItems, eq(ppeItems.id, ppeInspections.itemId))
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
            actions={
              can(ctx, 'ppe.inspect') ? (
                <Link href={`${BASE}?drawer=inspect-other`} scroll={false}>
                  <Button>
                    <ClipboardCheck size={14} /> <GeneratedText id="m_14b75074ab6734" />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <PpeSubNav active="inspections" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_03945ee3d559c0')} />
            {(
              [
                ['kind', KINDS, 'Kind', 'All kinds'],
                ['result', RESULTS, 'Result', 'All results'],
                ['status', STATUSES, 'Status', 'All statuses'],
                ['source', SOURCES, 'PPE', 'All PPE'],
              ] as const
            ).map(([key, options, title, all]) => (
              <FilterChips
                key={key}
                basePath={BASE}
                currentParams={sp}
                paramKey={key}
                label={title}
                allLabel={all}
                options={options.map((value) => ({ value, label: label(value) }))}
              />
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        className="text-teal-700 hover:underline dark:text-teal-400"
                        href={mergeHref(BASE, sp, {
                          drawer: 'inspection',
                          inspectionId: row.inspection.id,
                        })}
                        scroll={false}
                      >
                        <GeneratedValue
                          value={row.serial ? `${row.type} · ${row.serial}` : row.type}
                        />
                      </Link>
                      {row.inspection.isOther ? (
                        <Badge variant="secondary">
                          <GeneratedText id="m_172b20c7c26e49" />
                        </Badge>
                      ) : null}
                    </div>
                    {row.inspection.suppliedBy ? (
                      <div className="text-xs text-slate-500">
                        <GeneratedValue value={row.inspection.suppliedBy} />
                      </div>
                    ) : null}
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
                      href={`/ppe/inspections/${row.inspection.id}/pdf`}
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
      <PpeInspectionDetailDrawer
        ctx={ctx}
        inspectionId={drawer === 'inspection' ? pickString(sp.inspectionId) : undefined}
        closeHref={mergeHref(BASE, sp, { drawer: undefined, inspectionId: undefined })}
      />
      <PpeOtherInspectionDrawer
        ctx={ctx}
        open={drawer === 'inspect-other'}
        typeId={pickString(sp.otherType)}
        basePath={BASE}
      />
    </ListPageLayout>
  )
}
