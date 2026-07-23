'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ReportSchedule } from '@beaconhs/reports'
import {
  ReportScheduleForm,
  type ReportScheduleDefinitionOption,
  type ReportScheduleMemberOption,
} from '@beaconhs/reports/react'
import { useGeneratedTranslations } from '@/i18n/generated'
import { saveSchedule } from './actions'

export function BeaconScheduleForm({
  scheduleId,
  definitions,
  members,
  initial,
  defaultTimezone,
}: {
  scheduleId: string | null
  definitions: ReportScheduleDefinitionOption[]
  members: ReportScheduleMemberOption[]
  initial?: Partial<ReportSchedule>
  defaultTimezone?: string
}) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-3">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}
      <ReportScheduleForm
        definitions={definitions}
        members={members}
        initial={initial}
        defaultTimezone={defaultTimezone}
        submitLabel={scheduleId ? tGenerated('m_094591d6c7ec4e') : tGenerated('m_1c516d834dca35')}
        busy={pending}
        onCancel={() => router.push('/reports/schedules')}
        onSubmit={(value) => {
          setError(null)
          startTransition(async () => {
            const result = await saveSchedule(scheduleId, value)
            if (!result.ok) setError(result.error)
            else router.push(`/reports/schedules/${result.id}`)
          })
        }}
      />
    </div>
  )
}
