import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound } from 'next/navigation'
import {
  Badge,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { isUuid, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { EVERYONE_KEY, type AudienceItem } from '@/components/audience-picker'
import { recurrenceValueFromStored } from '@/components/recurrence'
import { StatusBadge, SummaryStrip } from '../../_shared'
import { KIND_META, kindLabel, type ObligationKind } from '../_meta'
import { cadenceLabel, obligationCompliance } from '../_data'
import { loadObligationFormOptions } from '../_form-options'
import { ObligationDetailActions } from './_detail-actions'
import { ObligationEditDrawer, type ObligationEditData } from './_edit-drawer'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_186a52fb889daf') }
}
export const dynamic = 'force-dynamic'

const SORTS = ['subject', 'status', 'due', 'completed', 'count'] as const
const STATUS_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
] as const

export default async function ObligationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const data = await obligationCompliance(ctx, id)
  if (!data) notFound()
  const { obligation: ob, audience, result } = data
  const hasCounts = result.rows.some((r) => r.expected != null)
  const subjectNoun =
    ob.subjectKind === 'per_record'
      ? 'Record'
      : ob.subjectKind === 'per_task'
        ? 'Sign-off'
        : 'Person'

  const audienceLabel =
    audience.length === 0 || audience.some((a) => a.kind === 'everyone')
      ? 'Everyone'
      : `${audience.length} audience target${audience.length === 1 ? '' : 's'}`

  const canManage = can(ctx, 'compliance.manage')
  // Only kinds the unified form can author are editable (rules out future
  // ETL-only source modules); such obligations stay manageable (pause/delete).
  const editable = canManage && ob.sourceModule in KIND_META
  const basePath = `/compliance/obligations/${ob.id}`
  const statusParam = pickString(sp.status)
  const statusFilter = STATUS_OPTIONS.find((option) => option.value === statusParam)?.value
  const listParams = parseListParams(sp, {
    sort: 'status',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const query = listParams.q?.toLowerCase()
  const subjectRows = result.rows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false
    if (!query) return true
    return [row.label, row.status, row.dueOn ?? '', row.completedOn ?? '']
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
  const statusRank = (status: string) =>
    status === 'overdue'
      ? 0
      : status === 'expiring'
        ? 1
        : status === 'pending'
          ? 2
          : status === 'in_progress'
            ? 3
            : 4
  const mult = listParams.dir === 'asc' ? 1 : -1
  subjectRows.sort((a, b) => {
    const comparison =
      listParams.sort === 'subject'
        ? a.label.localeCompare(b.label)
        : listParams.sort === 'due'
          ? (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31')
          : listParams.sort === 'completed'
            ? (a.completedOn ?? '9999-12-31').localeCompare(b.completedOn ?? '9999-12-31')
            : listParams.sort === 'count'
              ? (a.count ?? 0) - (b.count ?? 0)
              : statusRank(a.status) - statusRank(b.status)
    return comparison * mult || a.label.localeCompare(b.label)
  })
  const pageCount = Math.max(1, Math.ceil(subjectRows.length / listParams.perPage))
  const page = Math.min(listParams.page, pageCount)
  const rows = subjectRows.slice((page - 1) * listParams.perPage, page * listParams.perPage)
  const statusCounts = Object.fromEntries(
    STATUS_OPTIONS.map((option) => [
      option.value,
      result.rows.filter((row) => row.status === option.value).length,
    ]),
  )

  // Edit flyout — opened via ?drawer=edit. Reuses the audience already loaded
  // for the compliance evaluation; the picker uses the EVERYONE_KEY sentinel
  // where stored rows use the everyone kind.
  let edit: ObligationEditData | null = null
  if (editable && pickString(sp.drawer) === 'edit') {
    const initialAudience: AudienceItem[] = audience.map((a) => ({
      // Compliance obligations only ever use the 6 compliance audience kinds;
      // the crew/person_group kinds are notification-only, so this narrows safely.
      type: a.kind as AudienceItem['type'],
      entityKey: a.kind === 'everyone' ? EVERYONE_KEY : a.entityKey,
    }))
    const { targets, audienceOptions } = await loadObligationFormOptions(ctx, {
      targetRef: ob.targetRef ?? {},
      audience: initialAudience,
    })
    edit = {
      kind: ob.sourceModule as ObligationKind,
      targets,
      audienceOptions,
      initial: {
        id: ob.id,
        title: ob.title,
        notes: ob.notes,
        audience: initialAudience,
        recurrence: recurrenceValueFromStored(ob.recurrence),
        targetRef: ob.targetRef ?? {},
      },
    }
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/compliance/obligations', label: 'Back to obligations' }}
          title={tGeneratedValue(ob.title)}
          subtitle={tGeneratedValue(
            `${kindLabel(ob.sourceModule)} · ${cadenceLabel(ob.recurrence)}${
              ob.subjectKind === 'per_person' ? ` · ${audienceLabel}` : ''
            }`,
          )}
          actions={
            <ObligationDetailActions
              id={ob.id}
              enabled={ob.status === 'active'}
              canManage={canManage}
              canEdit={editable}
              editHref={mergeHref(basePath, sp, { drawer: 'edit' })}
            />
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <GeneratedValue value={kindLabel(ob.sourceModule)} />
          </Badge>
          <Badge variant={ob.status === 'active' ? 'success' : 'secondary'}>
            <GeneratedValue
              value={
                ob.status === 'active' ? (
                  <GeneratedText id="m_1e1b1fdb7dd78e" />
                ) : ob.status === 'paused' ? (
                  <GeneratedText id="m_0ea7ffe3f671e7" />
                ) : (
                  ob.status
                )
              }
            />
          </Badge>
        </div>

        <GeneratedValue
          value={
            ob.notes ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <GeneratedValue value={ob.notes} />
              </p>
            ) : null
          }
        />

        <SummaryStrip
          percent={result.percent}
          totals={result.totals}
          title={tGenerated('m_096d47f60747b3')}
        />

        <TableToolbar>
          <SearchInput
            placeholder={tGenerated('m_13a874065f07f8', { value0: subjectNoun.toLowerCase() })}
          />
          <FilterChips
            basePath={basePath}
            currentParams={sp}
            paramKey="status"
            label={tGenerated('m_0b9da892d6faf0')}
            options={STATUS_OPTIONS.map((option) => ({
              ...option,
              count: statusCounts[option.value] ?? 0,
            }))}
          />
        </TableToolbar>

        <GeneratedValue
          value={
            rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                <GeneratedValue
                  value={
                    result.rows.length === 0 ? (
                      <GeneratedText id="m_0d2196aaf22a7a" />
                    ) : (
                      <GeneratedText id="m_10b5c83a6fc1d9" />
                    )
                  }
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <SortableTh
                      basePath={basePath}
                      currentParams={sp}
                      dir={listParams.dir}
                      column="subject"
                      active={listParams.sort === 'subject'}
                    >
                      <GeneratedValue value={subjectNoun} />
                    </SortableTh>
                    <SortableTh
                      basePath={basePath}
                      currentParams={sp}
                      dir={listParams.dir}
                      column="status"
                      active={listParams.sort === 'status'}
                    >
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortableTh>
                    <SortableTh
                      basePath={basePath}
                      currentParams={sp}
                      dir={listParams.dir}
                      column="due"
                      active={listParams.sort === 'due'}
                    >
                      <GeneratedText id="m_0c2eb92551e08b" />
                    </SortableTh>
                    <SortableTh
                      basePath={basePath}
                      currentParams={sp}
                      dir={listParams.dir}
                      column="completed"
                      active={listParams.sort === 'completed'}
                    >
                      <GeneratedText id="m_0ba7a5e1b2fa32" />
                    </SortableTh>
                    <GeneratedValue
                      value={
                        hasCounts ? (
                          <>
                            <SortableTh
                              basePath={basePath}
                              currentParams={sp}
                              dir={listParams.dir}
                              column="count"
                              active={listParams.sort === 'count'}
                            >
                              <GeneratedText id="m_1842bc939bfcba" />
                            </SortableTh>
                            <TableHead>
                              <GeneratedText id="m_177b0d9a8ef383" />
                            </TableHead>
                          </>
                        ) : null
                      }
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((r, i) => (
                      <TableRow key={r.key}>
                        <TableCell className="text-slate-500 dark:text-slate-400">
                          <GeneratedValue value={(page - 1) * listParams.perPage + i + 1} />
                        </TableCell>
                        <TableCell className="text-slate-900 dark:text-slate-100">
                          <GeneratedValue value={r.label} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          <GeneratedValue value={r.dueOn ?? '—'} />
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          <GeneratedValue value={r.completedOn ?? '—'} />
                        </TableCell>
                        <GeneratedValue
                          value={
                            hasCounts ? (
                              <>
                                <TableCell className="text-slate-700 dark:text-slate-300">
                                  <GeneratedValue value={r.count ?? '—'} />
                                </TableCell>
                                <TableCell className="text-slate-700 dark:text-slate-300">
                                  <GeneratedValue value={r.expected ?? '—'} />
                                </TableCell>
                              </>
                            ) : null
                          }
                        />
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
            )
          }
        />

        <Pagination
          basePath={basePath}
          currentParams={sp}
          total={subjectRows.length}
          page={page}
          perPage={listParams.perPage}
        />

        <ObligationEditDrawer
          edit={edit}
          closeHref={mergeHref(basePath, sp, { drawer: undefined })}
        />
      </div>
    </PageContainer>
  )
}
