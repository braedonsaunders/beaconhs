import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// /incidents/injury-types — flat CRUD over the tenant's injury-type taxonomy.
// Injury rows assign one or more of these through the canonical join table.
//
// Standard table primitive for the list; create + edit happen in a right-side
// flyout (?drawer=new | ?drawer=<id>). Archive / delete stay as row actions.

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Plus, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { and, asc, desc, eq, count, ilike, inArray, or, type SQL } from 'drizzle-orm'
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
import { incidentInjuryTypeAssignments, incidentInjuryTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { IncidentsSubNav } from '../_sub-nav'
import { InjuryTypeDrawer } from './_drawers'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0a5b093d5cee01') }
}
export const dynamic = 'force-dynamic'

const BASE = '/incidents/injury-types'
const SORTS = ['name', 'osha', 'status'] as const

async function saveInjuryType(input: {
  id?: string
  name: string
  oshaCode: string | null
  description: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(incidentInjuryTypes)
        .where(eq(incidentInjuryTypes.id, input.id!))
        .limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Injury type not found.' }
    await ctx.db((tx) =>
      tx
        .update(incidentInjuryTypes)
        .set({ name, description: input.description, oshaCode: input.oshaCode })
        .where(eq(incidentInjuryTypes.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_injury_type',
      entityId: input.id,
      action: 'update',
      summary: `Updated "${name}"`,
      before: { name: before.name, description: before.description, oshaCode: before.oshaCode },
      after: { name, description: input.description, oshaCode: input.oshaCode },
    })
  } else {
    const [row] = await ctx.db((tx) =>
      tx
        .insert(incidentInjuryTypes)
        .values({
          tenantId: ctx.tenantId,
          name,
          description: input.description,
          oshaCode: input.oshaCode,
          createdByTenantUserId: ctx.membership?.id ?? null,
        })
        .returning(),
    )
    if (row) {
      await recordAudit(ctx, {
        entityType: 'incident_injury_type',
        entityId: row.id,
        action: 'create',
        summary: `Added injury type "${name}"`,
        after: { name, oshaCode: input.oshaCode },
      })
    }
  }
  revalidatePath(BASE)
  return { ok: true }
}

async function toggleArchive(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const id = String(formData.get('id') ?? '')
  const next = formData.get('isActive') === 'true' ? 1 : 0
  if (!id) return
  await ctx.db((tx) =>
    tx.update(incidentInjuryTypes).set({ isActive: next }).where(eq(incidentInjuryTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident_injury_type',
    entityId: id,
    action: 'update',
    summary: next ? 'Restored from archive' : 'Archived',
    after: { isActive: !!next },
  })
  revalidatePath(BASE)
}

async function deleteInjuryType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const [{ usage } = { usage: 0 }] = await ctx.db((tx) =>
    tx
      .select({ usage: count() })
      .from(incidentInjuryTypeAssignments)
      .where(eq(incidentInjuryTypeAssignments.injuryTypeId, id)),
  )
  if (Number(usage ?? 0) > 0) {
    await ctx.db((tx) =>
      tx.update(incidentInjuryTypes).set({ isActive: 0 }).where(eq(incidentInjuryTypes.id, id)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_injury_type',
      entityId: id,
      action: 'archive',
      summary: 'Archived (referenced by existing injuries — hard delete refused)',
    })
  } else {
    await ctx.db((tx) => tx.delete(incidentInjuryTypes).where(eq(incidentInjuryTypes.id, id)))
    await recordAudit(ctx, {
      entityType: 'incident_injury_type',
      entityId: id,
      action: 'delete',
      summary: 'Deleted injury type',
    })
  }
  revalidatePath(BASE)
}

export default async function InjuryTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const drawerParam = pickString(sp.drawer)
  const statusParam = pickString(sp.status)
  const statusFilter =
    statusParam === 'active' || statusParam === 'archived' ? statusParam : undefined
  const ctx = await requireModuleManage('incidents')

  const dir = params.dir === 'asc' ? asc : desc
  const orderBy =
    params.sort === 'osha'
      ? dir(incidentInjuryTypes.oshaCode)
      : params.sort === 'status'
        ? dir(incidentInjuryTypes.isActive)
        : dir(incidentInjuryTypes.name)

  const { rows, total, usageById } = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(incidentInjuryTypes.name, `%${params.q}%`),
          ilike(incidentInjuryTypes.oshaCode, `%${params.q}%`),
          ilike(incidentInjuryTypes.description, `%${params.q}%`),
        )
      : undefined
    const status =
      statusFilter === 'active'
        ? eq(incidentInjuryTypes.isActive, 1)
        : statusFilter === 'archived'
          ? eq(incidentInjuryTypes.isActive, 0)
          : undefined
    const where = and(search, status)
    const [totalRow] = await tx.select({ c: count() }).from(incidentInjuryTypes).where(where)
    const data = await tx
      .select()
      .from(incidentInjuryTypes)
      .where(where)
      .orderBy(orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const rowIds = data.map((row) => row.id)
    const usage =
      rowIds.length === 0
        ? []
        : await tx
            .select({ id: incidentInjuryTypeAssignments.injuryTypeId, c: count() })
            .from(incidentInjuryTypeAssignments)
            .where(inArray(incidentInjuryTypeAssignments.injuryTypeId, rowIds))
            .groupBy(incidentInjuryTypeAssignments.injuryTypeId)
    const usageMap: Record<string, number> = {}
    for (const u of usage) if (u.id) usageMap[u.id] = Number(u.c)
    return { rows: data, total: Number(totalRow?.c ?? 0), usageById: usageMap }
  })

  const editing =
    drawerParam && drawerParam !== 'new' ? (rows.find((r) => r.id === drawerParam) ?? null) : null
  const mode: 'new' | 'edit' | null = drawerParam === 'new' ? 'new' : editing ? 'edit' : null
  const closeHref = mergeHref(BASE, sp, { drawer: undefined })
  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_0a5b093d5cee01')}
            description={tGenerated('m_022d38f409f0ff')}
            actions={
              <Link href={mergeHref(BASE, sp, { drawer: 'new' }) as any} scroll={false}>
                <Button>
                  <Plus size={14} /> <GeneratedText id="m_0e487713d94f19" />
                </Button>
              </Link>
            }
          />
          <IncidentsSubNav active="injury-types" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_146d2788d2f568')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Plus size={32} />}
              title={tGeneratedValue(
                params.q || statusFilter
                  ? tGenerated('m_0a6e45a38ae5c2')
                  : tGenerated('m_0f98f880407b66'),
              )}
              description={tGeneratedValue(
                params.q || statusFilter
                  ? tGenerated('m_076a0cc0a4fd82')
                  : tGenerated('m_089107d7a5f164'),
              )}
              action={
                <Link href={mergeHref(BASE, sp, { drawer: 'new' }) as any} scroll={false}>
                  <Button>
                    <GeneratedText id="m_0e487713d94f19" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                    <GeneratedText id="m_02b18d5c7f6f2d" />
                  </SortableTh>
                  <SortableTh {...sortProps} column="osha" active={params.sort === 'osha'}>
                    <GeneratedText id="m_1321e20f44dd66" />
                  </SortableTh>
                  <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                    <GeneratedText id="m_0b9da892d6faf0" />
                  </SortableTh>
                  <TableHead className="text-right">
                    <GeneratedText id="m_1667b6eab4ed93" />
                  </TableHead>
                  <TableHead className="text-right">
                    <GeneratedText id="m_0a7f1858f2ec46" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <GeneratedValue
                  value={rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          href={mergeHref(BASE, sp, { drawer: r.id }) as any}
                          scroll={false}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          <GeneratedValue value={r.name} />
                        </Link>
                        <GeneratedValue
                          value={
                            r.description ? (
                              <div className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                                <GeneratedValue value={r.description} />
                              </div>
                            ) : null
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <GeneratedValue
                          value={
                            r.oshaCode ? (
                              <Badge variant="outline" className="font-mono text-xs">
                                <GeneratedValue value={r.oshaCode} />
                              </Badge>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <GeneratedValue
                          value={
                            r.isActive ? (
                              <Badge variant="success">
                                <GeneratedText id="m_1e1b1fdb7dd78e" />
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-300 text-amber-800">
                                <GeneratedText id="m_12a687134482ba" />
                              </Badge>
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums dark:text-slate-400">
                        <GeneratedValue value={usageById[r.id] ?? 0} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Link
                            href={mergeHref(BASE, sp, { drawer: r.id }) as any}
                            scroll={false}
                            className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                          >
                            <GeneratedText id="m_03a66f9d34ac7b" />
                          </Link>
                          <form action={toggleArchive} className="inline">
                            <input type="hidden" name="id" value={r.id} />
                            <input
                              type="hidden"
                              name="isActive"
                              value={r.isActive ? 'false' : 'true'}
                            />
                            <button
                              type="submit"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                              title={tGeneratedValue(
                                r.isActive
                                  ? tGenerated('m_019c0a64030688')
                                  : tGenerated('m_19500e41842c99'),
                              )}
                            >
                              <GeneratedValue
                                value={
                                  r.isActive ? <Archive size={14} /> : <ArchiveRestore size={14} />
                                }
                              />
                            </button>
                          </form>
                          <form action={deleteInjuryType} className="inline">
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              type="submit"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                              title={tGeneratedValue(
                                (usageById[r.id] ?? 0) > 0
                                  ? tGenerated('m_0e35ca85b0b5e4', { value0: usageById[r.id] })
                                  : tGenerated('m_11773f3c3f7558'),
                              )}
                            >
                              <Trash2 size={14} />
                            </button>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                />
              </TableBody>
            </Table>
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

      <InjuryTypeDrawer
        mode={mode}
        editing={editing}
        closeHref={closeHref}
        saveAction={saveInjuryType}
      />
    </ListPageLayout>
  )
}
