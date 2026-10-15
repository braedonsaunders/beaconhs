import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, type SelectOption } from '@beaconhs/ui'
import { LiveField, LiveRemoteSelect, LiveSelect } from '@/components/live-field'

// The skill "Skill details" card — the auto-saving field set for the unified
// assignment page. "New skill" creates the row immediately (default
// person/skill type) and lands here, where every field edits inline.

type SkillFieldValues = {
  personId: string
  skillTypeId: string
  grantedOn: string
  expiresOn: string | null
  notes: string | null
  status: string
}

type SkillFieldInitialOptions = {
  person?: SelectOption
  skillType?: SelectOption
}

export function SkillDetailFields({
  initial,
  initialOptions,
  disabled,
  personHref,
}: {
  initial: SkillFieldValues
  initialOptions: SkillFieldInitialOptions
  disabled?: boolean
  personHref?: string | null
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedText id="m_0726401650a205" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0 space-y-1">
            <LiveRemoteSelect
              field="personId"
              label={tGenerated('m_12e926c9216094')}
              initialValue={initial.personId}
              initialOption={initialOptions.person}
              lookup="training-skill-assignment-people"
              emptyLabel={tGenerated('m_0be39d3a196b5b')}
              disabled={disabled}
            />
            <GeneratedValue
              value={
                personHref ? (
                  <Link
                    href={personHref as never}
                    className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                  >
                    <GeneratedText id="m_158274742d32f3" />
                  </Link>
                ) : null
              }
            />
          </div>
          <LiveRemoteSelect
            field="skillTypeId"
            label={tGenerated('m_0f4481ed349502')}
            initialValue={initial.skillTypeId}
            initialOption={initialOptions.skillType}
            lookup="training-skill-assignment-types"
            emptyLabel={tGenerated('m_1ac86a66a34aae')}
            disabled={disabled}
          />
        </div>
        <LiveSelect
          field="status"
          label={tGenerated('m_0b9da892d6faf0')}
          initialValue={initial.status}
          options={['draft', 'expired', 'complete', 'tested', 'recommended', 'failed'].map(
            (value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }),
          )}
          allowEmpty={false}
          disabled={disabled}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveField
            field="grantedOn"
            label={tGenerated('m_06ff18f1003d06')}
            type="date"
            initialValue={initial.grantedOn}
            disabled={disabled}
          />
          <LiveField
            field="expiresOn"
            label={tGenerated('m_001b29133dcb72')}
            type="date"
            initialValue={initial.expiresOn}
            disabled={disabled}
          />
        </div>
        <LiveField
          field="notes"
          label={tGenerated('m_0b8dadcb78cd08')}
          initialValue={initial.notes}
          multiline
          rows={3}
          disabled={disabled}
        />
      </CardContent>
    </Card>
  )
}
