'use client'

import { useRouter } from 'next/navigation'
import type { ReportSchedule } from '@beaconhs/reports'
import { ReportScheduleList, type ReportScheduleDefinitionOption } from '@beaconhs/reports/react'
import { runScheduleNow, setScheduleActive } from './actions'

export function BeaconScheduleList({
  schedules,
  definitions,
  query,
  status,
  total,
  page,
  canManage,
}: {
  schedules: ReportSchedule[]
  definitions: ReportScheduleDefinitionOption[]
  query: string
  status: 'all' | 'active' | 'paused'
  total: number
  page: number
  canManage: boolean
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
    router.push(`/reports/schedules${params.size ? `?${params}` : ''}`)
  }
  return (
    <ReportScheduleList
      schedules={schedules}
      definitions={definitions}
      query={query}
      status={status}
      total={total}
      page={page}
      perPage={25}
      canManage={canManage}
      onQueryChange={(q) => navigate({ q })}
      onStatusChange={(next) => navigate({ status: next })}
      onPageChange={(next) => navigate({ page: next })}
      onCreate={() => router.push('/reports/schedules/new')}
      onOpen={(schedule) => router.push(`/reports/schedules/${schedule.id}`)}
      onToggle={(schedule) => setScheduleActive(schedule.id, !schedule.active)}
      onRun={(schedule) => runScheduleNow(schedule.id)}
    />
  )
}
