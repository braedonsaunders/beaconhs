import Link from 'next/link'
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
import { can, assertCan } from '@beaconhs/tenant'
import { GeneratedValue } from '@/i18n/generated'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import {
  listEquipmentInspectionStatus,
  EQUIPMENT_INSPECTION_STATUS_LABELS,
  type EquipmentInspectionStatus,
} from '@/lib/equipment/inspection-status'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('Equipment inspection status') }
}
export const dynamic = 'force-dynamic'
const BASE = '/equipment/maintenance/inspection-status'
export default async function EquipmentInspectionStatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getGeneratedValueTranslations(),
    ctx = await requireRequestContext(),
    sp = await searchParams
  if (
    !['equipment.read.self', 'equipment.read.site', 'equipment.read.all', 'equipment.manage'].some(
      (permission) => can(ctx, permission),
    )
  )
    assertCan(ctx, 'equipment.read.self')
  const params = parseListParams(sp, {
    sort: 'status',
    dir: 'asc',
    allowedSorts: ['status'],
    perPage: 25,
  })
  const status = pickString(sp.status)
  const request = {
    q: params.q,
    status:
      status && status in EQUIPMENT_INSPECTION_STATUS_LABELS
        ? (status as EquipmentInspectionStatus)
        : undefined,
    page: params.page,
    perPage: params.perPage,
  }
  let data = await listEquipmentInspectionStatus(ctx, request)
  const page = Math.min(params.page, Math.max(1, Math.ceil(data.total / params.perPage)))
  if (page !== params.page) data = await listEquipmentInspectionStatus(ctx, { ...request, page })
  const options = Object.entries(EQUIPMENT_INSPECTION_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  }))
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={t('Equipment inspection status')}
            description={t(
              'Calendar inspection schedules for active equipment. Units without an active schedule are not configured; this does not mean an inspection is legally required. Pre-use checks remain on each unit.',
            )}
            actions={
              <div className="flex flex-wrap gap-2">
                <Link href="/equipment/maintenance">
                  <Button variant="outline">
                    <GeneratedValue value="Maintenance" />
                  </Button>
                </Link>
                {can(ctx, 'equipment.manage') ? (
                  <Link href="/equipment/inspection-types">
                    <Button variant="outline">
                      <GeneratedValue value="Inspection types" />
                    </Button>
                  </Link>
                ) : null}
              </div>
            }
          />
          <EquipmentSubNav active="maintenance" />
          <TableToolbar>
            <SearchInput placeholder={t('Search equipment…')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label={t('Status')}
              options={options}
            />
          </TableToolbar>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {options.map((option) => (
          <div key={option.value} className="rounded-lg border p-3">
            <div className="text-xs text-slate-500">
              <GeneratedValue value={option.label} />
            </div>
            <div className="text-2xl font-semibold">
              <GeneratedValue value={data.counts[option.value as EquipmentInspectionStatus]} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-500">
        <GeneratedValue value="Active schedules without a due date also need configuration. They stay active and do not send dated reminders until a real due date is entered." />
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            {['Equipment', 'Type', 'Active inspection schedules', 'Next due', 'Status'].map(
              (label) => (
                <TableHead key={label}>
                  <GeneratedValue value={label} />
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link className="hover:underline" href={`/equipment/${row.id}?tab=inspections`}>
                  <GeneratedValue value={`${row.name} (${row.asset_tag})`} />
                </Link>
              </TableCell>
              <TableCell>
                <GeneratedValue value={row.type_name ?? '—'} />
              </TableCell>
              <TableCell>
                <GeneratedValue value={row.schedules} />
              </TableCell>
              <TableCell>
                <GeneratedValue value={row.next_due_on ?? '—'} />
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    row.status === 'overdue'
                      ? 'destructive'
                      : row.status === 'due_soon'
                        ? 'warning'
                        : 'secondary'
                  }
                >
                  <GeneratedValue value={EQUIPMENT_INSPECTION_STATUS_LABELS[row.status]} />
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.total === 0 ? (
        <p className="p-4 text-sm text-slate-500">
          <GeneratedValue value="No matching equipment." />
        </p>
      ) : null}
      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={data.total}
        page={page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}
