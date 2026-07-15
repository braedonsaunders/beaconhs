import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
  equipmentInspectionCriteria,
  equipmentInspectionTypes,
  equipmentTypes,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams, pickString } from '@/lib/list-params'
import { formatInterval } from '@/lib/equipment/intervals'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { NewTypeDrawer, DeleteTypeButton } from './_drawers'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_03128168830db0') }
}
export const dynamic = 'force-dynamic'

const BASE = '/equipment/inspection-types'
const SORTS = ['name', 'applies', 'interval'] as const

export default async function InspectionTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const openNew = pickString(sp.drawer) === 'new'
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireModuleManage('equipment')

  const { rows, total, types, counts } = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(equipmentInspectionTypes.name, `%${params.q}%`),
          ilike(equipmentInspectionTypes.description, `%${params.q}%`),
        )
      : undefined

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'applies'
        ? [dirFn(equipmentTypes.name), asc(equipmentInspectionTypes.name)]
        : params.sort === 'interval'
          ? [
              // Sort cadences coarsest-first by unit then value; pre-use and
              // on-demand (null unit) sort together at the end.
              dirFn(equipmentInspectionTypes.intervalUnit),
              dirFn(equipmentInspectionTypes.intervalValue),
              asc(equipmentInspectionTypes.name),
            ]
          : [dirFn(equipmentInspectionTypes.name)]

    const [tot] = await tx
      .select({ c: count() })
      .from(equipmentInspectionTypes)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentInspectionTypes.appliesToTypeId))
      .where(search)
    const data = await tx
      .select({ t: equipmentInspectionTypes, applies: equipmentTypes })
      .from(equipmentInspectionTypes)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentInspectionTypes.appliesToTypeId))
      .where(search)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const types = await tx
      .select({ id: equipmentTypes.id, name: equipmentTypes.name })
      .from(equipmentTypes)
      .orderBy(asc(equipmentTypes.name))
    const tally = await tx
      .select({ inspectionTypeId: equipmentInspectionCriteria.inspectionTypeId, c: count() })
      .from(equipmentInspectionCriteria)
      .groupBy(equipmentInspectionCriteria.inspectionTypeId)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      types,
      counts: Object.fromEntries(tally.map((x) => [x.inspectionTypeId, Number(x.c)])),
    }
  })

  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_17ee43f67eec17')}
            description={tGenerated('m_182085259693c7')}
            actions={
              <Link href="/equipment/inspection-types?drawer=new" scroll={false}>
                <Button>
                  <GeneratedText id="m_13f748eec4ec4b" />
                </Button>
              </Link>
            }
          />
          <EquipmentSubNav active="inspection-types" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1ad7824f9dc087')} />
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
                params.q ? tGenerated('m_0b007409dc07ee') : tGenerated('m_10158d03ab60b5'),
              )}
              description={tGenerated('m_09c31f1b45e744')}
              action={
                <Link href="/equipment/inspection-types?drawer=new" scroll={false}>
                  <Button>
                    <GeneratedText id="m_13f748eec4ec4b" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="applies" active={params.sort === 'applies'}>
                      <GeneratedText id="m_05fe235eb37ec6" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="interval"
                      active={params.sort === 'interval'}
                    >
                      <GeneratedText id="m_0a847756f27f7f" />
                    </SortableTh>
                    <TableHead className="text-right">
                      <GeneratedText id="m_1a1ce62686f0b8" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0224d237ee9682" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_1ab93cc4aeeb13" />
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ t, applies }) => {
                      const n = counts[t.id] ?? 0
                      return (
                        <TableRow key={t.id}>
                          <TableCell>
                            <Link
                              href={`/equipment/inspection-types/${t.id}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={t.name} />
                            </Link>
                            <GeneratedValue
                              value={
                                t.description ? (
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    <GeneratedValue value={t.description} />
                                  </div>
                                ) : null
                              }
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <GeneratedValue
                              value={
                                applies?.name ?? (
                                  <span className="text-slate-400 italic">
                                    <GeneratedText id="m_0c8af3286accda" />
                                  </span>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              <GeneratedValue
                                value={formatInterval(t.intervalValue, t.intervalUnit, {
                                  preUse: t.isPreUse,
                                })}
                              />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={n > 0 ? 'success' : 'warning'}>
                              <GeneratedValue value={n} />
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                t.failsSpawnWorkOrders ? (
                                  <Badge variant="success">
                                    <GeneratedText id="m_1b34c7d70d09bd" />
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_117d1a5e1ef440" />
                                  </Badge>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                t.allowPassAll ? (
                                  <Badge variant="success">
                                    <GeneratedText id="m_1b34c7d70d09bd" />
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_117d1a5e1ef440" />
                                  </Badge>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <DeleteTypeButton id={t.id} name={t.name} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
                </TableBody>
              </Table>
            </div>
          )
        }
      />

      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />

      <NewTypeDrawer open={openNew} closeHref="/equipment/inspection-types" types={types} />
    </ListPageLayout>
  )
}
