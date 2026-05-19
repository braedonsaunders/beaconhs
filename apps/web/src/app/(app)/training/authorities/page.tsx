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
import { requireRequestContext } from '@/lib/auth'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'

export const metadata = { title: 'Skill Authorities' }

const SORTS = ['name', 'code', 'jurisdiction', 'created_at'] as const

export default async function TrainingAuthoritiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireRequestContext()

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

    const [tot] = await tx
      .select({ c: count() })
      .from(trainingSkillAuthorities)
      .where(whereClause)

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
            title="Skill Authorities"
            description="Bodies that issue training credentials — unions, regulators, internal QC. Each authority owns one or more skill types."
            actions={
              <Link href="/training/authorities/new">
                <Button>New authority</Button>
              </Link>
            }
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search by name, code, or jurisdiction" />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Award size={32} />}
          title={params.q ? `No authorities match "${params.q}"` : 'No skill authorities yet'}
          description="Create an authority to start tracking who issues which credentials."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                  Code
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="jurisdiction"
                  active={params.sort === 'jurisdiction'}
                >
                  Jurisdiction
                </SortableTh>
                <TableHead>Skill types</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ authority, typeCount }) => (
                <TableRow key={authority.id}>
                  <TableCell>
                    <Link
                      href={`/training/authorities/${authority.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {authority.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">
                    {authority.code ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">{authority.jurisdiction ?? '—'}</TableCell>
                  <TableCell className="text-slate-600 tabular-nums">{typeCount}</TableCell>
                </TableRow>
              ))}
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
      )}
    </ListPageLayout>
  )
}
