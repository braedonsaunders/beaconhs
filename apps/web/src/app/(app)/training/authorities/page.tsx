import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Award } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import {
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
import { trainingSkillAuthorities, trainingSkillTypes } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { createAuthority } from '../_actions/authorities'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0a845d4e3be78d') }
}

const SORTS = ['name', 'code', 'jurisdiction', 'created_at'] as const

export default async function TrainingAuthoritiesPage({
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
  const ctx = await requireModuleManage('training')

  const { rows, total } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(trainingSkillAuthorities.name, term),
        ilike(trainingSkillAuthorities.code, term),
        ilike(trainingSkillAuthorities.jurisdiction, term),
      )
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'code'
        ? [
            params.dir === 'asc'
              ? asc(trainingSkillAuthorities.code)
              : desc(trainingSkillAuthorities.code),
          ]
        : params.sort === 'jurisdiction'
          ? [
              params.dir === 'asc'
                ? asc(trainingSkillAuthorities.jurisdiction)
                : desc(trainingSkillAuthorities.jurisdiction),
            ]
          : params.sort === 'created_at'
            ? [
                params.dir === 'asc'
                  ? asc(trainingSkillAuthorities.createdAt)
                  : desc(trainingSkillAuthorities.createdAt),
              ]
            : [
                params.dir === 'asc'
                  ? asc(trainingSkillAuthorities.name)
                  : desc(trainingSkillAuthorities.name),
              ]

    const [tot] = await tx.select({ c: count() }).from(trainingSkillAuthorities).where(whereClause)

    const data = await tx
      .select({
        authority: trainingSkillAuthorities,
        typeCount: sql<number>`count(${trainingSkillTypes.id})`.mapWith(Number),
      })
      .from(trainingSkillAuthorities)
      .leftJoin(trainingSkillTypes, eq(trainingSkillTypes.authorityId, trainingSkillAuthorities.id))
      .where(whereClause)
      .groupBy(trainingSkillAuthorities.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    return { rows: data, total: Number(tot?.c ?? 0) }
  })

  const sortProps = { basePath: '/training/authorities', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_0a845d4e3be78d')}
            description={tGenerated('m_0b029741bf23e6')}
            actions={
              <form action={createAuthority}>
                <Button type="submit">
                  <GeneratedText id="m_0ec039c6d55777" />
                </Button>
              </form>
            }
          />
          <TrainingSubNav active="authorities" />
          <div className="flex items-center gap-3">
            <SearchInput placeholder={tGenerated('m_1cfc76cec68c43')} />
          </div>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Award size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_10292bba0c31e9', { value0: params.q })
                  : tGenerated('m_133d4d4c2d4547'),
              )}
              description={tGenerated('m_03aa72339f254d')}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                      <GeneratedText id="m_0570e24c85cf95" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="jurisdiction"
                      active={params.sort === 'jurisdiction'}
                    >
                      <GeneratedText id="m_15f4b2d236f39a" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_1427f1a1b00a0b" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ authority, typeCount }) => (
                      <TableRow key={authority.id}>
                        <TableCell>
                          <Link
                            href={`/training/authorities/${authority.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={authority.name} />
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={authority.code ?? '—'} />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={authority.jurisdiction ?? '—'} />
                        </TableCell>
                        <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
                          <GeneratedValue value={typeCount} />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath="/training/authorities"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
    </ListPageLayout>
  )
}
