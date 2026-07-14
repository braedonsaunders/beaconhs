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
  if (correctiveActionData.total === 0 && incidentData.total === 0) return null

  return (
    <Section title="Spawned from this response">
      <div className="grid gap-5 xl:grid-cols-2">
        {correctiveActionData.total > 0 ? (
          <SpawnedList
            title="Corrective actions"
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
        ) : null}
        {incidentData.total > 0 ? (
          <SpawnedList
            title="Incidents"
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
        ) : null}
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
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {title} ({total.toLocaleString()})
      </div>
      <TableToolbar className="mb-3">
        <SearchInput
          placeholder={`Search ${title.toLowerCase()}…`}
          paramKey={searchParam}
          pageParamKey={pageParam}
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey={statusParam}
          pageParamKey={pageParam}
          label="Status"
          options={statusOptions}
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey={sortParam}
          pageParamKey={pageParam}
          label="Order"
          defaultValue="recent"
          hideAll
          options={ORDER_OPTIONS}
        />
      </TableToolbar>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
          No {title.toLowerCase()} match this search or filter.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`${detailBasePath}/${row.id}`}
                className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-xs text-slate-500">{row.reference}</span>
                  <span className="truncate text-slate-900 dark:text-slate-100">{row.title}</span>
                </span>
                <Badge variant="secondary" className="shrink-0">
                  {humanize(row.status)}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comments ({data.total.toLocaleString()})</CardTitle>
      </CardHeader>
      <CardContent>
        <TableToolbar className="mb-3">
          <SearchInput
            placeholder="Search comments or authors…"
            paramKey="commentQ"
            pageParamKey="commentPage"
          />
          <FilterChips
            basePath={basePath}
            currentParams={currentParams}
            paramKey="commentSort"
            pageParamKey="commentPage"
            label="Order"
            defaultValue="recent"
            hideAll
            options={ORDER_OPTIONS}
          />
        </TableToolbar>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={24} />}
            title={data.total === 0 ? 'No comments' : 'No matching comments'}
            description={
              data.total === 0
                ? 'Discussion between reviewers and submitters, follow-up notes, and correction history.'
                : 'Change the search to see other comments.'
            }
          />
        ) : (
          <ul className="space-y-3 text-sm">
            {data.rows.map((comment) => (
              <li
                key={comment.id}
                className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{comment.authorName ?? 'Someone'}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {formatDateTime(comment.createdAt, timeZone, locale)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        )}
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
  if (data.total === 0) return null

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        Check-in history ({data.total.toLocaleString()})
      </div>
      <TableToolbar className="mb-3">
        <SearchInput
          placeholder="Search check-in notes…"
          paramKey="checkinQ"
          pageParamKey="checkinPage"
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey="checkinKind"
          pageParamKey="checkinPage"
          label="Kind"
          options={[...CHECKIN_KIND_OPTIONS]}
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey="checkinSort"
          pageParamKey="checkinPage"
          label="Order"
          defaultValue="recent"
          hideAll
          options={ORDER_OPTIONS}
        />
      </TableToolbar>
      {data.rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No check-ins match this search or filter.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.rows.map((checkin) => (
            <li
              key={checkin.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300"
            >
              <span className="font-mono text-slate-400">
                {formatDateTime(checkin.recordedAt, timeZone, locale)}
              </span>
              <span>{humanize(checkin.kind)}</span>
              {checkin.geoLat != null && checkin.geoLng != null ? (
                <a
                  href={`https://www.google.com/maps?q=${checkin.geoLat},${checkin.geoLng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-teal-700 hover:underline dark:text-teal-300"
                >
                  <MapPin size={11} /> map
                </a>
              ) : null}
              {checkin.note ? (
                <span className="min-w-0 text-slate-500">— {checkin.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit trail ({data.total.toLocaleString()})</CardTitle>
      </CardHeader>
      <CardContent>
        <TableToolbar className="mb-3">
          <SearchInput
            placeholder="Search activity…"
            paramKey="activityQ"
            pageParamKey="activityPage"
          />
          <FilterChips
            basePath={basePath}
            currentParams={currentParams}
            paramKey="activityAction"
            pageParamKey="activityPage"
            label="Action"
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
            label="Order"
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
