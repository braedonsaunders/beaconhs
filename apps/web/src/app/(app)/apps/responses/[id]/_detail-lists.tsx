import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import Link from 'next/link'
import { MapPin, MessageSquare } from 'lucide-react'
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@beaconhs/ui'
import type { AppLocale } from '@beaconhs/i18n'
import { ActivityFeed } from '@/components/activity-feed'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { Section } from '@/components/section'
import { TableToolbar } from '@/components/table-toolbar'
import { formatDateTime } from '@/lib/datetime'
import {
  CHECKIN_KIND_OPTIONS,
  CORRECTIVE_ACTION_STATUS_OPTIONS,
  INCIDENT_STATUS_OPTIONS,
  type ResponseDetailListState,
} from './_detail-list-state'

type Search = Record<string, string | string[] | undefined>

type CorrectiveActionRow = {
  id: string
  reference: string
  title: string
  status: string
}

type IncidentRow = {
  id: string
  reference: string
  title: string
  status: string
}

type CommentRow = {
  id: string
  body: string
  createdAt: Date
  authorName: string | null
}

type CheckinRow = {
  id: string
  kind: string
  recordedAt: Date
  geoLat: number | null
  geoLng: number | null
  note: string | null
}

type ActivityRow = {
  id: string
  action: string
  summary: string | null
  actor: string | null
  occurredAt: Date
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

type PageData<T> = {
  rows: T[]
  total: number
  filteredTotal: number
}

const ORDER_OPTIONS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

export function SpawnedRecordsSection({
  basePath,
  currentParams,
  correctiveActionParams,
  correctiveActionData,
  incidentParams,
  incidentData,
}: {
  basePath: string
  currentParams: Search
  correctiveActionParams: ResponseDetailListState['correctiveActions']
  correctiveActionData: PageData<CorrectiveActionRow>
  incidentParams: ResponseDetailListState['incidents']
  incidentData: PageData<IncidentRow>
}) {
  const tGenerated = useGeneratedTranslations()
  if (correctiveActionData.total === 0 && incidentData.total === 0) return null

  return (
    <Section title={tGenerated('m_11026a257622e7')}>
      <div className="grid gap-5 xl:grid-cols-2">
        <GeneratedValue
          value={
            correctiveActionData.total > 0 ? (
              <SpawnedList
                title={tGenerated('m_09ff419c80cb22')}
                total={correctiveActionData.total}
                rows={correctiveActionData.rows}
                filteredTotal={correctiveActionData.filteredTotal}
                params={correctiveActionParams}
                basePath={basePath}
                currentParams={currentParams}
                detailBasePath="/corrective-actions"
                searchParam="caQ"
                pageParam="caPage"
                statusParam="caStatus"
                sortParam="caSort"
                statusOptions={[...CORRECTIVE_ACTION_STATUS_OPTIONS]}
              />
            ) : null
          }
        />
        <GeneratedValue
          value={
            incidentData.total > 0 ? (
              <SpawnedList
                title={tGenerated('m_1f0a25de4c8df0')}
                total={incidentData.total}
                rows={incidentData.rows}
                filteredTotal={incidentData.filteredTotal}
                params={incidentParams}
                basePath={basePath}
                currentParams={currentParams}
                detailBasePath="/incidents"
                searchParam="incidentQ"
                pageParam="incidentPage"
                statusParam="incidentStatus"
                sortParam="incidentSort"
                statusOptions={[...INCIDENT_STATUS_OPTIONS]}
              />
            ) : null
          }
        />
      </div>
    </Section>
  )
}

function SpawnedList({
  title,
  total,
  rows,
  filteredTotal,
  params,
  basePath,
  currentParams,
  detailBasePath,
  searchParam,
  pageParam,
  statusParam,
  sortParam,
  statusOptions,
}: {
  title: string
  total: number
  rows: Array<CorrectiveActionRow | IncidentRow>
  filteredTotal: number
  params: ResponseDetailListState['correctiveActions'] | ResponseDetailListState['incidents']
  basePath: string
  currentParams: Search
  detailBasePath: '/corrective-actions' | '/incidents'
  searchParam: 'caQ' | 'incidentQ'
  pageParam: 'caPage' | 'incidentPage'
  statusParam: 'caStatus' | 'incidentStatus'
  sortParam: 'caSort' | 'incidentSort'
  statusOptions: { value: string; label: string }[]
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={title} /> (<GeneratedValue value={total.toLocaleString()} />)
      </div>
      <TableToolbar className="mb-3">
        <SearchInput
          placeholder={tGenerated('m_1f0a8c50aedb8c', { value0: title.toLowerCase() })}
          paramKey={searchParam}
          pageParamKey={pageParam}
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey={statusParam}
          pageParamKey={pageParam}
          label={tGenerated('m_0b9da892d6faf0')}
          options={statusOptions}
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey={sortParam}
          pageParamKey={pageParam}
          label={tGenerated('m_126e942baf656b')}
          defaultValue="recent"
          hideAll
          options={ORDER_OPTIONS}
        />
      </TableToolbar>
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <GeneratedText id="m_117d1a5e1ef440" /> <GeneratedValue value={title.toLowerCase()} />{' '}
              <GeneratedText id="m_0b54953b9849e2" />
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              <GeneratedValue
                value={rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`${detailBasePath}/${row.id}`}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 font-mono text-xs text-slate-500">
                          <GeneratedValue value={row.reference} />
                        </span>
                        <span className="truncate text-slate-900 dark:text-slate-100">
                          <GeneratedValue value={row.title} />
                        </span>
                      </span>
                      <Badge variant="secondary" className="shrink-0">
                        <GeneratedValue value={humanize(row.status)} />
                      </Badge>
                    </Link>
                  </li>
                ))}
              />
            </ul>
          )
        }
      />
      <Pagination
        basePath={basePath}
        currentParams={currentParams}
        total={filteredTotal}
        page={params.page}
        perPage={params.perPage}
        pageParamKey={pageParam}
      />
    </div>
  )
}

export function CommentsPanel({
  basePath,
  currentParams,
  params,
  data,
  timeZone,
  locale,
}: {
  basePath: string
  currentParams: Search
  params: ResponseDetailListState['comments']
  data: PageData<CommentRow>
  timeZone: string
  locale: AppLocale
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedText id="m_18063a9246a7f4" />
          <GeneratedValue value={data.total.toLocaleString()} />)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TableToolbar className="mb-3">
          <SearchInput
            placeholder={tGenerated('m_0d9c714c62f97f')}
            paramKey="commentQ"
            pageParamKey="commentPage"
          />
          <FilterChips
            basePath={basePath}
            currentParams={currentParams}
            paramKey="commentSort"
            pageParamKey="commentPage"
            label={tGenerated('m_126e942baf656b')}
            defaultValue="recent"
            hideAll
            options={ORDER_OPTIONS}
          />
        </TableToolbar>
        <GeneratedValue
          value={
            data.rows.length === 0 ? (
              <EmptyState
                icon={<MessageSquare size={24} />}
                title={tGeneratedValue(
                  data.total === 0
                    ? tGenerated('m_0416133d263051')
                    : tGenerated('m_046352e42c6073'),
                )}
                description={tGeneratedValue(
                  data.total === 0
                    ? tGenerated('m_0ce13f84fd6789')
                    : tGenerated('m_16dd75ed5d3062'),
                )}
              />
            ) : (
              <ul className="space-y-3 text-sm">
                <GeneratedValue
                  value={data.rows.map((comment) => (
                    <li
                      key={comment.id}
                      className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">
                          <GeneratedValue
                            value={comment.authorName ?? <GeneratedText id="m_014e77626c919b" />}
                          />
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          <GeneratedValue
                            value={formatDateTime(comment.createdAt, timeZone, locale)}
                          />
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                        <GeneratedValue value={comment.body} />
                      </p>
                    </li>
                  ))}
                />
              </ul>
            )
          }
        />
        <Pagination
          basePath={basePath}
          currentParams={currentParams}
          total={data.filteredTotal}
          page={params.page}
          perPage={params.perPage}
          pageParamKey="commentPage"
        />
      </CardContent>
    </Card>
  )
}

export function CheckinHistory({
  basePath,
  currentParams,
  params,
  data,
  timeZone,
  locale,
}: {
  basePath: string
  currentParams: Search
  params: ResponseDetailListState['checkins']
  data: PageData<CheckinRow>
  timeZone: string
  locale: AppLocale
}) {
  const tGenerated = useGeneratedTranslations()
  if (data.total === 0) return null

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_1a08d9a6536a48" />
        <GeneratedValue value={data.total.toLocaleString()} />)
      </div>
      <TableToolbar className="mb-3">
        <SearchInput
          placeholder={tGenerated('m_02ca7e8755da19')}
          paramKey="checkinQ"
          pageParamKey="checkinPage"
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey="checkinKind"
          pageParamKey="checkinPage"
          label={tGenerated('m_1e578efe1574cd')}
          options={[...CHECKIN_KIND_OPTIONS]}
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey="checkinSort"
          pageParamKey="checkinPage"
          label={tGenerated('m_126e942baf656b')}
          defaultValue="recent"
          hideAll
          options={ORDER_OPTIONS}
        />
      </TableToolbar>
      <GeneratedValue
        value={
          data.rows.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_18a2334e26b172" />
            </p>
          ) : (
            <ul className="space-y-1.5">
              <GeneratedValue
                value={data.rows.map((checkin) => (
                  <li
                    key={checkin.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300"
                  >
                    <span className="font-mono text-slate-400">
                      <GeneratedValue
                        value={formatDateTime(checkin.recordedAt, timeZone, locale)}
                      />
                    </span>
                    <span>
                      <GeneratedValue value={humanize(checkin.kind)} />
                    </span>
                    <GeneratedValue
                      value={
                        checkin.geoLat != null && checkin.geoLng != null ? (
                          <a
                            href={`https://www.google.com/maps?q=${checkin.geoLat},${checkin.geoLng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-teal-700 hover:underline dark:text-teal-300"
                          >
                            <MapPin size={11} /> <GeneratedText id="m_022351def434d8" />
                          </a>
                        ) : null
                      }
                    />
                    <GeneratedValue
                      value={
                        checkin.note ? (
                          <span className="min-w-0 text-slate-500">
                            — <GeneratedValue value={checkin.note} />
                          </span>
                        ) : null
                      }
                    />
                  </li>
                ))}
              />
            </ul>
          )
        }
      />
      <Pagination
        basePath={basePath}
        currentParams={currentParams}
        total={data.filteredTotal}
        page={params.page}
        perPage={params.perPage}
        pageParamKey="checkinPage"
      />
    </div>
  )
}

export function AuditTrailPanel({
  basePath,
  currentParams,
  params,
  data,
  timeZone,
  locale,
}: {
  basePath: string
  currentParams: Search
  params: ResponseDetailListState['activity']
  data: PageData<ActivityRow> & { actions: { action: string; count: number }[] }
  timeZone: string
  locale: AppLocale
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedText id="m_067d0504ff1603" />
          <GeneratedValue value={data.total.toLocaleString()} />)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TableToolbar className="mb-3">
          <SearchInput
            placeholder={tGenerated('m_1b028fe99601a3')}
            paramKey="activityQ"
            pageParamKey="activityPage"
          />
          <FilterChips
            basePath={basePath}
            currentParams={currentParams}
            paramKey="activityAction"
            pageParamKey="activityPage"
            label={tGenerated('m_0bad495a7046e9')}
            options={data.actions.map(({ action, count }) => ({
              value: action,
              label: humanize(action),
              count,
            }))}
          />
          <FilterChips
            basePath={basePath}
            currentParams={currentParams}
            paramKey="activitySort"
            pageParamKey="activityPage"
            label={tGenerated('m_126e942baf656b')}
            defaultValue="recent"
            hideAll
            options={ORDER_OPTIONS}
          />
        </TableToolbar>
        <ActivityFeed entries={data.rows} timeZone={timeZone} locale={locale} />
        <Pagination
          basePath={basePath}
          currentParams={currentParams}
          total={data.filteredTotal}
          page={params.page}
          perPage={params.perPage}
          pageParamKey="activityPage"
        />
      </CardContent>
    </Card>
  )
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}
