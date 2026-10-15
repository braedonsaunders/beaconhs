'use client'

// When, where, and the hour-meter reading of an equipment inspection. Each
// field is written to the device first and synced by the flyout's
// <OfflineRecordProvider> (applied by ../_record-edits.ts).

import { useGeneratedTranslations } from '@/i18n/generated'
import { LiveDateTime, LiveField, LiveRemoteSelect, ReadOnlyField } from '@/components/live-field'

export function RecordMeta({
  occurredAt,
  occurredAtDisplay,
  hours,
  notes,
  locked,
  site,
}: {
  /** `YYYY-MM-DDTHH:mm` in the worker's timezone. */
  occurredAt: string
  occurredAtDisplay: string
  hours: string
  notes: string
  locked: boolean
  site?: { value: string; label: string }
}) {
  const tGenerated = useGeneratedTranslations()

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-3 dark:border-slate-800">
      {locked ? (
        <ReadOnlyField label={tGenerated('m_16b944034f43b6')} value={occurredAtDisplay} />
      ) : (
        <LiveDateTime
          field="occurredAt"
          label={tGenerated('m_16b944034f43b6')}
          initialValue={occurredAt}
        />
      )}
      <LiveRemoteSelect
        field="siteOrgUnitId"
        label={tGenerated('m_096619f6fb1aae')}
        initialValue={site?.value ?? ''}
        initialOption={site}
        lookup="equipment-inspection-sites"
        disabled={locked}
      />
      <LiveField
        field="hours"
        label={tGenerated('m_08a3b41b1849a6')}
        type="number"
        initialValue={hours}
        disabled={locked}
      />
      <div className="sm:col-span-3">
        <LiveField
          field="notes"
          label={tGenerated('m_0b8dadcb78cd08')}
          multiline
          rows={2}
          initialValue={notes}
          disabled={locked}
        />
      </div>
    </div>
  )
}
