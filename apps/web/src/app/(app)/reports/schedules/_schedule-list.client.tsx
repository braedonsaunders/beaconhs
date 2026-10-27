'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReportSchedule } from '@beaconhs/reports'
import { ReportScheduleList, type ReportScheduleDefinitionOption } from '@beaconhs/reports/react'
import { useGeneratedTranslations } from '@/i18n/generated'
import { confirmDialog } from '@/lib/confirm'
import { deleteSchedule, runScheduleNow, setScheduleActive } from './actions'

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
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  // The shared list's search input is fully controlled, so hold the typed
  // value locally and debounce the URL navigation behind it — one router
  // push per pause in typing instead of one per keystroke.
  const [searchDraft, setSearchDraft] = useState({ query, value: query })
  const localQuery = searchDraft.query === query ? searchDraft.value : query
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    [],
  )
  const navigate = (next: { q?: string; status?: string; page?: number }) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const params = new URLSearchParams()
    const q = next.q ?? localQuery
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
      query={localQuery}
      status={status}
      total={total}
      page={page}
      perPage={25}
      canManage={canManage}
      onQueryChange={(q) => {
        setSearchDraft({ query, value: q })
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => navigate({ q }), 300)
      }}
      onStatusChange={(next) => navigate({ status: next })}
      onPageChange={(next) => navigate({ page: next })}
      onCreate={() => router.push('/reports/schedules?drawer=new')}
      onOpen={(schedule) => router.push(`/reports/schedules/${schedule.id}`)}
      onToggle={(schedule) => setScheduleActive(schedule.id, !schedule.active)}
      onRun={(schedule) => runScheduleNow(schedule.id)}
      onDelete={async (schedule) => {
        const confirmed = await confirmDialog({
          message: tGenerated('m_1ad2edf6aa00fb', { value0: schedule.name }),
          confirmLabel: tGenerated('m_11773f3c3f7558'),
          tone: 'danger',
        })
        if (!confirmed) return
        await deleteSchedule(schedule.id)
        router.refresh()
      }}
    />
  )
}
