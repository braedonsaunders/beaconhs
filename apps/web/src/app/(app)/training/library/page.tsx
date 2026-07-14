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

export const metadata = { title: 'Content Library' }
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
            title="Content Library"
            description="Reusable lessons, videos, files, and embeds."
          />
          <TrainingSubNav active="library" />
          <TableToolbar
            trailing={
              <form action={createContentItem} className="flex items-center gap-1.5">
                <Input name="title" placeholder="New item title…" className="h-8 w-44" />
                <Select name="kind" defaultValue="rich" className="h-8 w-28">
                  <option value="rich">Lesson</option>
                  <option value="slides">Slideshow</option>
                  <option value="video">Video</option>
                  <option value="file">File</option>
                  <option value="embed">Embed</option>
                </Select>
                <Button type="submit" size="sm">
                  Add
                </Button>
              </form>
            }
          >
            <SearchInput placeholder="Search library…" />
            <FilterChips
              basePath="/training/library"
              currentParams={sp}
              paramKey="kind"
              label="Type"
              options={KIND_OPTIONS.map((o) => ({ ...o, count: kindCounts[o.value] }))}
            />
            {tagVocab.length > 0 ? (
              <FilterChips
                basePath="/training/library"
                currentParams={sp}
                paramKey="tag"
                label="Tag"
                options={tagVocab.map((t) => ({ value: t, label: t }))}
              />
            ) : null}
          </TableToolbar>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<FileText size={32} />}
          title={
            q || kindFilter || tagFilter
              ? 'No items match these filters'
              : 'Your content library is empty'
          }
          description="Create reusable lessons, videos, files, or embeds, then drop them into any course."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => {
              const used = usageMap[it.id] ?? 0
              return (
                <Link key={it.id} href={`/training/library/${it.id}`} className="group block">
                  <div className="flex h-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 transition-shadow group-hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {KIND_ICON[it.kind]}
                        {KIND_OPTIONS.find((k) => k.value === it.kind)?.label ?? it.kind}
                      </span>
                      <Badge variant="secondary">
                        {used === 0 ? 'unused' : `in ${used} course${used === 1 ? '' : 's'}`}
                      </Badge>
                    </div>
                    <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {it.title}
                    </h3>
                    {it.description ? (
                      <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
                        {it.description}
                      </p>
                    ) : null}
                    {it.tags && it.tags.length > 0 ? (
                      <div className="mt-auto flex flex-wrap gap-1 pt-1">
                        {it.tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>
          <Pagination
            basePath="/training/library"
            currentParams={sp}
            total={itemCount}
            page={listParams.page}
            perPage={listParams.perPage}
          />
        </div>
      )}
    </ListPageLayout>
  )
}
