import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { revalidatePath } from 'next/cache'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  not,
  or,
  type SQL,
} from 'drizzle-orm'
import { Tag, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { documentTypes, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'
import { DocumentsSubNav } from '../_components/documents-sub-nav'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_16fcb25a72b387') }
}
export const dynamic = 'force-dynamic'

const BASE = '/documents/types'
const SORTS = ['name', 'key'] as const

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function createType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const name = String(formData.get('name') ?? '').trim()
  const keyInput = String(formData.get('key') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const color = String(formData.get('color') ?? '').trim() || null
  if (!name) return
  const key = keyInput ? slugify(keyInput) : slugify(name)
  if (!key) return

  const [row] = await ctx.db(async (tx) => {
    return tx
      .insert(documentTypes)
      .values({ tenantId: ctx.tenantId, key, name, description, color })
      .onConflictDoNothing({ target: [documentTypes.tenantId, documentTypes.key] })
      .returning()
  })
  if (row) {
    await recordAudit(ctx, {
      entityType: 'document_type',
      entityId: row.id,
      action: 'create',
      summary: `Created document type "${name}"`,
      after: { name, key, color },
    })
  }
  revalidatePath('/documents/types')
}

async function updateType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const color = String(formData.get('color') ?? '').trim() || null
  if (!id || !name) return
  await ctx.db((tx) =>
    tx.update(documentTypes).set({ name, description, color }).where(eq(documentTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_type',
    entityId: id,
    action: 'update',
    summary: 'Updated document type',
    after: { name, description, color },
  })
  revalidatePath('/documents/types')
}

async function deleteType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(documentTypes).set({ deletedAt: new Date() }).where(eq(documentTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_type',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted document type',
  })
  revalidatePath('/documents/types')
}

export default async function DocumentTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const usageParam = pickString(sp.usage)
  const usageFilter = usageParam === 'used' || usageParam === 'unused' ? usageParam : undefined
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireModuleManage('documents')

  const { rows, total, usedCount, unusedCount, usageMap } = await ctx.db(async (tx) => {
    const active = isNull(documentTypes.deletedAt)
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(documentTypes.name, `%${params.q}%`),
          ilike(documentTypes.key, `%${params.q}%`),
          ilike(documentTypes.description, `%${params.q}%`),
        )
      : undefined
    const hasDocuments = exists(
      tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.typeId, documentTypes.id), isNull(documents.deletedAt))),
    )
    const usage =
      usageFilter === 'used'
        ? hasDocuments
        : usageFilter === 'unused'
          ? not(hasDocuments)
          : undefined
    const where = and(active, search, usage)
    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy = params.sort === 'key' ? [dirFn(documentTypes.key)] : [dirFn(documentTypes.name)]

    const [totalRow, usedRow, unusedRow, data] = await Promise.all([
      tx.select({ c: count() }).from(documentTypes).where(where),
      tx
        .select({ c: count() })
        .from(documentTypes)
        .where(and(active, search, hasDocuments)),
      tx
        .select({ c: count() })
        .from(documentTypes)
        .where(and(active, search, not(hasDocuments))),
      tx
        .select()
        .from(documentTypes)
        .where(where)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
    ])
    const rowIds = data.map((row) => row.id)
    const usageRows =
      rowIds.length === 0
        ? []
        : await tx
            .select({ typeId: documents.typeId, c: count() })
            .from(documents)
            .where(and(isNull(documents.deletedAt), inArray(documents.typeId, rowIds)))
            .groupBy(documents.typeId)
    return {
      rows: data,
      total: Number(totalRow[0]?.c ?? 0),
      usedCount: Number(usedRow[0]?.c ?? 0),
      unusedCount: Number(unusedRow[0]?.c ?? 0),
      usageMap: Object.fromEntries(usageRows.map((u) => [u.typeId ?? '', Number(u.c)])),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_16fcb25a72b387')}
            description={tGenerated('m_008a6a05407473')}
          />
          <DocumentsSubNav active="types" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0221566cc10150')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="usage"
              label={tGenerated('m_0ae3b4ff7213f7')}
              options={[
                { value: 'used', label: 'Used', count: usedCount },
                { value: 'unused', label: 'Unused', count: unusedCount },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_06607bad805033" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createType} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  <GeneratedText id="m_1a9978900838e6" />
                </Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder={tGenerated('m_1a0d3e771cb437')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key">
                  <GeneratedText id="m_169ff65a3cfc14" />
                </Label>
                <Input id="key" name="key" placeholder={tGenerated('m_1bde8095d3803d')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="color">
                  <GeneratedText id="m_1242677f454516" />
                </Label>
                <Input id="color" name="color" type="color" defaultValue="#0f766e" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="description">
                  <GeneratedText id="m_14d923495cf14c" />
                </Label>
                <Textarea id="description" name="description" rows={2} />
              </div>
              <div className="flex justify-end sm:col-span-2">
                <Button type="submit">
                  <GeneratedText id="m_0e7e7c12ed8560" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <GeneratedValue
          value={
            rows.length === 0 ? (
              <EmptyState
                icon={<Tag size={32} />}
                title={tGeneratedValue(
                  !params.q && !usageFilter
                    ? tGenerated('m_1db2b978cbe389')
                    : tGenerated('m_19a7102421fb99'),
                )}
                description={tGeneratedValue(
                  !params.q && !usageFilter
                    ? tGenerated('m_0270d26ad980b0')
                    : tGenerated('m_129e288f81c0c1'),
                )}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_1c4a1719773bee" />
                    <GeneratedValue value={total} />)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortableTh
                            basePath={BASE}
                            currentParams={sp}
                            dir={params.dir}
                            column="name"
                            active={params.sort === 'name'}
                          >
                            <GeneratedText id="m_02b18d5c7f6f2d" />
                          </SortableTh>
                          <SortableTh
                            basePath={BASE}
                            currentParams={sp}
                            dir={params.dir}
                            column="key"
                            active={params.sort === 'key'}
                          >
                            <GeneratedText id="m_169ff65a3cfc14" />
                          </SortableTh>
                          <TableHead>
                            <GeneratedText id="m_1242677f454516" />
                          </TableHead>
                          <TableHead>
                            <GeneratedText id="m_0b47933c7ed907" />
                          </TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <GeneratedValue
                          value={rows.map((t) => {
                            const usage = usageMap[t.id] ?? 0
                            return (
                              <TableRow key={t.id}>
                                <TableCell>
                                  <form
                                    action={updateType}
                                    className="flex flex-col gap-2 sm:flex-row sm:items-center"
                                  >
                                    <input type="hidden" name="id" value={t.id} />
                                    <Input
                                      name="name"
                                      defaultValue={t.name}
                                      className="max-w-xs min-w-0"
                                    />
                                    <Input
                                      name="description"
                                      defaultValue={t.description ?? ''}
                                      placeholder={tGenerated('m_072f698e1dc2a6')}
                                      className="max-w-md min-w-0"
                                    />
                                    <Input
                                      name="color"
                                      type="color"
                                      defaultValue={t.color ?? '#0f766e'}
                                      className="h-8 w-12 shrink-0 p-0"
                                    />
                                    <Button type="submit" size="sm" variant="outline">
                                      <GeneratedText id="m_19e6bff894c3c7" />
                                    </Button>
                                  </form>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  <GeneratedValue value={t.key} />
                                </TableCell>
                                <TableCell>
                                  <span
                                    className="inline-block h-4 w-8 rounded border border-slate-200 align-middle"
                                    style={{ background: t.color ?? '#0f766e' }}
                                  />
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  <Badge variant={usage > 0 ? 'secondary' : 'outline'}>
                                    <GeneratedValue value={usage} />{' '}
                                    <GeneratedValue
                                      value={
                                        usage === 1 ? (
                                          <GeneratedText id="m_08927559ee23e3" />
                                        ) : (
                                          <GeneratedText id="m_0211a9acf0110a" />
                                        )
                                      }
                                    />
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <form action={deleteType} className="inline">
                                    <input type="hidden" name="id" value={t.id} />
                                    <Button
                                      type="submit"
                                      variant="ghost"
                                      size="sm"
                                      aria-label={tGenerated('m_12fda1066d2e96')}
                                    >
                                      <Trash2 size={14} className="text-red-500" />
                                    </Button>
                                  </form>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        />
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
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
      </div>
    </ListPageLayout>
  )
}
