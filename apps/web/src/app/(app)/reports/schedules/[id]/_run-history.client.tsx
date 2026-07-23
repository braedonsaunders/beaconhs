'use client'

import { useRouter } from 'next/navigation'
import { ReportRunHistory, type ReportScheduleRun } from '@beaconhs/reports/react'

export function BeaconReportRunHistory({
  scheduleId,
  runs,
  query,
  status,
  total,
  page,
}: {
  scheduleId: string
  runs: ReportScheduleRun[]
  query: string
  status: 'all' | 'queued' | 'running' | 'succeeded' | 'failed'
  total: number
  page: number
}) {
  const router = useRouter()
  const navigate = (next: { q?: string; status?: string; page?: number }) => {
    const params = new URLSearchParams()
    const q = next.q ?? query
    const filter = next.status ?? status
    const targetPage = next.page ?? 1
    if (q) params.set('q', q)
    if (filter !== 'all') params.set('status', filter)
    if (targetPage > 1) params.set('page', String(targetPage))
    router.push(`/reports/schedules/${scheduleId}${params.size ? `?${params}` : ''}`)
  }
  return (
    <ReportRunHistory
      runs={runs}
      query={query}
      status={status}
      total={total}
      page={page}
      perPage={25}
      onQueryChange={(q) => navigate({ q })}
      onStatusChange={(next) => navigate({ status: next })}
      onPageChange={(next) => navigate({ page: next })}
      onOpen={(run) => router.push(`/reports/schedules/${scheduleId}/runs/${run.id}`)}
    />
  )
}
