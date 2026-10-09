'use client'

import { useGeneratedTranslations } from '@/i18n/generated'
import { LiveDateTime, LiveField, LiveRemoteSelect } from '@/components/live-field'
import { updateEquipmentInspectionMeta } from '../_actions'

export function RecordMeta({
  recordId,
  occurredAt,
  occurredAtDisplay,
  hours,
  notes,
  locked,
  site,
}: {
  recordId: string
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
        <LiveField
          id={recordId}
          field="occurredAt"
          label={tGenerated('m_16b944034f43b6')}
          initialValue={occurredAtDisplay}
          disabled
          updateAction={updateEquipmentInspectionMeta}
        />
      ) : (
        <LiveDateTime
          id={recordId}
          field="occurredAt"
          label={tGenerated('m_16b944034f43b6')}
          initialValue={occurredAt}
          updateAction={updateEquipmentInspectionMeta}
        />
      )}
      <LiveRemoteSelect
        id={recordId}
        field="siteOrgUnitId"
        label={tGenerated('m_096619f6fb1aae')}
        initialValue={site?.value ?? ''}
        initialOption={site}
        lookup="equipment-inspection-sites"
        disabled={locked}
        updateAction={updateEquipmentInspectionMeta}
      />
      <LiveField
        id={recordId}
        field="hours"
        label={tGenerated('m_08a3b41b1849a6')}
        type="number"
        initialValue={hours}
        disabled={locked}
        updateAction={updateEquipmentInspectionMeta}
      />
      <div className="sm:col-span-3">
        <LiveField
          id={recordId}
          field="notes"
          label={tGenerated('m_0b8dadcb78cd08')}
          multiline
          rows={2}
          initialValue={notes}
          disabled={locked}
          updateAction={updateEquipmentInspectionMeta}
        />
      </div>
    </div>
  )
}
