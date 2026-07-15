import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { FileText, Link2, Paperclip, Presentation, Video } from 'lucide-react'
import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { Badge, Button, EmptyState, Input, PageHeader, Select } from '@beaconhs/ui'
import { trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { createContentItem } from './_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1f0089a4ed720e') }
}
export const dynamic = 'force-dynamic'

const KIND_OPTIONS = [
  { value: 'rich', label: 'Lesson' },
  { value: 'slides', label: 'Slideshow' },
  { value: 'video', label: 'Video' },
  { value: 'file', label: 'File' },
  { value: 'embed', label: 'Embed' },
] as const
type ContentKind = (typeof KIND_OPTIONS)[number]['value']
const KIND_ICON: Record<string, ReactNode> = {
  rich: <FileText size={14} />,
  slides: <Presentation size={14} />,
  video: <Video size={14} />,
  file: <Paperclip size={14} />,
  embed: <Link2 size={14} />,
}
const SORTS = ['title'] as const

function isContentKind(value: string | undefined): value is ContentKind {
  return KIND_OPTIONS.some((option) => option.value === value)
}

export default async function ContentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'title',
    dir: 'asc',
    perPage: 24,
    allowedSorts: SORTS,
  })
  const q = listParams.q
  const requestedKind = pickString(sp.kind)
  const kindFilter = isContentKind(requestedKind) ? requestedKind : undefined
  const tagFilter = pickString(sp.tag)
  const ctx = await requireModuleManage('training')

  const { items, itemCount, usageMap, kindCounts, tagVocab } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(trainingContentItems.deletedAt)]
    if (q) {
      const term = `%${q}%`
      const c = or(
        ilike(trainingContentItems.title, term),
        ilike(trainingContentItems.description, term),
      )
      if (c) filters.push(c)
    }
    if (kindFilter) filters.push(eq(trainingContentItems.kind, kindFilter))
    if (tagFilter) filters.push(sql`${trainingContentItems.tags} ? ${tagFilter}`)

    const filteredWhere = and(...filters)
    const [[itemCountRow], items] = await Promise.all([
      tx.select({ c: count() }).from(trainingContentItems).where(filteredWhere),
      tx
        .select()
        .from(trainingContentItems)
        .where(filteredWhere)
        .orderBy(asc(trainingContentItems.title))
        .limit(listParams.perPage)
        .offset((listParams.page - 1) * listParams.perPage),
    ])

    const usage =
      items.length === 0
        ? []
        : await tx
            .select({ cid: trainingLessons.contentItemId, c: count() })
            .from(trainingLessons)
            .where(
              and(
                isNotNull(trainingLessons.contentItemId),
                inArray(
                  trainingLessons.contentItemId,
                  items.map((item) => item.id),
                ),
                isNull(trainingLessons.deletedAt),
              ),
            )
            .groupBy(trainingLessons.contentItemId)
    const usageMap: Record<string, number> = {}
    for (const u of usage) if (u.cid) usageMap[u.cid] = Number(u.c)

    const kinds = await tx
      .select({ k: trainingContentItems.kind, c: count() })
      .from(trainingContentItems)
      .where(isNull(trainingContentItems.deletedAt))
      .groupBy(trainingContentItems.kind)
    const kindCounts: Record<string, number> = {}
    for (const k of kinds) kindCounts[k.k] = Number(k.c)

    const tagResult = await tx.execute<{ tag: string }>(sql`
      select distinct jsonb_array_elements_text(${trainingContentItems.tags}) as tag
      from ${trainingContentItems}
      where ${trainingContentItems.deletedAt} is null
      order by tag
    `)
    const tagVocab = (tagResult as unknown as Array<{ tag: string }>).map((row) => row.tag)

    return {
      items,
      itemCount: Number(itemCountRow?.c ?? 0),
      usageMap,
      kindCounts,
      tagVocab,
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_1f0089a4ed720e')}
            description={tGenerated('m_041bf2ae90961b')}
          />
          <TrainingSubNav active="library" />
          <TableToolbar
            trailing={
              <form action={createContentItem} className="flex items-center gap-1.5">
                <Input
                  name="title"
                  placeholder={tGenerated('m_1101eeaf71ada7')}
                  className="h-8 w-44"
                />
                <Select name="kind" defaultValue="rich" className="h-8 w-28">
                  <option value="rich">
                    <GeneratedText id="m_167a70293e1237" />
                  </option>
                  <option value="slides">
                    <GeneratedText id="m_1c373e80a9436f" />
                  </option>
                  <option value="video">
                    <GeneratedText id="m_0813322ae97045" />
                  </option>
                  <option value="file">
                    <GeneratedText id="m_102a42d098d1d2" />
                  </option>
                  <option value="embed">
                    <GeneratedText id="m_1b25408f216531" />
                  </option>
                </Select>
                <Button type="submit" size="sm">
                  <GeneratedText id="m_16c8592e5020a4" />
                </Button>
              </form>
            }
          >
            <SearchInput placeholder={tGenerated('m_10dde6040d29e8')} />
            <FilterChips
              basePath="/training/library"
              currentParams={sp}
              paramKey="kind"
              label={tGenerated('m_074ba2f160c506')}
              options={KIND_OPTIONS.map((o) => ({ ...o, count: kindCounts[o.value] }))}
            />
            <GeneratedValue
              value={
                tagVocab.length > 0 ? (
                  <FilterChips
                    basePath="/training/library"
                    currentParams={sp}
                    paramKey="tag"
                    label={tGenerated('m_13ba7bb39ca8d9')}
                    options={tagVocab.map((t) => ({ value: t, label: t }))}
                  />
                ) : null
              }
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyState
              icon={<FileText size={32} />}
              title={tGeneratedValue(
                q || kindFilter || tagFilter
                  ? tGenerated('m_0fc645de450345')
                  : tGenerated('m_1a3d06a6f392c7'),
              )}
              description={tGenerated('m_1a5195bafec672')}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <GeneratedValue
                  value={items.map((it) => {
                    const used = usageMap[it.id] ?? 0
                    return (
                      <Link key={it.id} href={`/training/library/${it.id}`} className="group block">
                        <div className="flex h-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 transition-shadow group-hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                              <GeneratedValue value={KIND_ICON[it.kind]} />
                              <GeneratedValue
                                value={
                                  KIND_OPTIONS.find((k) => k.value === it.kind)?.label ?? it.kind
                                }
                              />
                            </span>
                            <Badge variant="secondary">
                              <GeneratedValue
                                value={
                                  used === 0 ? (
                                    <GeneratedText id="m_044bbea37f845d" />
                                  ) : (
                                    <GeneratedText
                                      id="m_1a89361093d7ea"
                                      values={{ value0: used, value1: used === 1 ? '' : 's' }}
                                    />
                                  )
                                }
                              />
                            </Badge>
                          </div>
                          <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={it.title} />
                          </h3>
                          <GeneratedValue
                            value={
                              it.description ? (
                                <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
                                  <GeneratedValue value={it.description} />
                                </p>
                              ) : null
                            }
                          />
                          <GeneratedValue
                            value={
                              it.tags && it.tags.length > 0 ? (
                                <div className="mt-auto flex flex-wrap gap-1 pt-1">
                                  <GeneratedValue
                                    value={it.tags.slice(0, 4).map((t) => (
                                      <span
                                        key={t}
                                        className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  />
                                </div>
                              ) : null
                            }
                          />
                        </div>
                      </Link>
                    )
                  })}
                />
              </div>
              <Pagination
                basePath="/training/library"
                currentParams={sp}
                total={itemCount}
                page={listParams.page}
                perPage={listParams.perPage}
              />
            </div>
          )
        }
      />
    </ListPageLayout>
  )
}
