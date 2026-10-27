'use client'

import { useRouter } from 'next/navigation'
import type {
  ReportScheduleDefinitionOption,
  ReportScheduleMemberOption,
} from '@beaconhs/reports/react'
import { BeaconScheduleForm } from './_schedule-form'

/** Create form hosted in the list page's ?drawer=new UrlDrawer: saving or
 *  cancelling closes the drawer (back to the bare list URL) and refreshes. */
export function NewScheduleDrawerForm({
  definitions,
  members,
  defaultTimezone,
}: {
  definitions: ReportScheduleDefinitionOption[]
  members: ReportScheduleMemberOption[]
  defaultTimezone: string
}) {
  const router = useRouter()
  const close = () => {
    router.push('/reports/schedules')
    router.refresh()
  }
  return (
    <BeaconScheduleForm
      scheduleId={null}
      definitions={definitions}
      members={members}
      defaultTimezone={defaultTimezone}
      onSaved={close}
      onCancel={close}
    />
  )
}
