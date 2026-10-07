'use client'

import { UserCog } from 'lucide-react'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { RemoteSearchSelect } from '@/components/remote-search-select'

export function JournalSupervisorField({
  value,
  disabled,
  requiredForSubmission = true,
  onChange,
}: {
  value: string | null
  disabled: boolean
  requiredForSubmission?: boolean
  onChange: (value: string | null) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <div className="space-y-1">
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
          <UserCog size={13} />
          <GeneratedValue value={'Supervisor'} />
          {requiredForSubmission ? <span aria-hidden="true">*</span> : null}
        </span>
        <RemoteSearchSelect
          lookup="journal-supervisors"
          value={value ?? ''}
          disabled={disabled}
          clearable
          emptyLabel={tGeneratedValue('None')}
          placeholder={tGeneratedValue('Choose supervisor…')}
          searchPlaceholder={tGeneratedValue('Search supervisors…')}
          sheetTitle={tGeneratedValue('Supervisor')}
          ariaLabel={tGeneratedValue(
            requiredForSubmission ? 'Supervisor (required for submission)' : 'Supervisor',
          )}
          onChange={(next) => onChange(next || null)}
        />
      </label>
      {requiredForSubmission && !value ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          <GeneratedValue value={'Choose an active supervisor before submitting your journal.'} />
        </p>
      ) : null}
    </div>
  )
}
