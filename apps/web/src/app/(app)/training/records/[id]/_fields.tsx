import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@beaconhs/ui'
import { LiveField, LivePersonSelect, LiveSelect } from '@/components/live-field'

// The certificate "Record details" card — the auto-saving field set for the
// unified record page. "New certificate" creates the row immediately (default
// person/course) and lands here, where every field edits inline.

type RecordFieldValues = {
  personId: string
  courseId: string
  source: string
  completedOn: string
  expiresOn: string | null
  instructor: string | null
  grade: string | null
  details: string | null
  notes: string | null
}

type RecordFieldOptions = {
  people: { id: string; firstName: string; lastName: string; employeeNo: string | null }[]
  courses: { id: string; name: string; code: string | null }[]
}

const SOURCE_OPTIONS = [
  { value: 'external_upload', label: 'External upload' },
  { value: 'class', label: 'Class' },
  { value: 'self_paced', label: 'Self-paced' },
  { value: 'evaluator', label: 'Evaluator' },
  { value: 'migrated', label: 'Migrated' },
]

export function RecordDetailFields({
  id,
  initial,
  options,
  disabled,
  personHref,
  courseHref,
  updateAction,
}: {
  id: string
  initial: RecordFieldValues
  options: RecordFieldOptions
  disabled?: boolean
  personHref?: string | null
  courseHref?: string | null
  updateAction: (formData: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedText id="m_03ac332652c3b2" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <LivePersonSelect
              id={id}
              field="personId"
              label={tGenerated('m_12e926c9216094')}
              initialValue={initial.personId}
              options={options.people.map((p) => ({
                value: p.id,
                label: `${p.lastName}, ${p.firstName}`,
                hint: p.employeeNo ?? undefined,
              }))}
              placeholder={tGenerated('m_0be39d3a196b5b')}
              searchPlaceholder={tGenerated('m_06c2338b990aea')}
              disabled={disabled}
              updateAction={updateAction}
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
          <div className="space-y-1">
            <LiveSelect
              id={id}
              field="courseId"
              label={tGenerated('m_14fc1e0739b60e')}
              initialValue={initial.courseId}
              emptyLabel={tGenerated('m_14a8ad5a2c909c')}
              options={options.courses.map((c) => ({
                value: c.id,
                label: c.code ? `${c.code} · ${c.name}` : c.name,
              }))}
              disabled={disabled}
              updateAction={updateAction}
            />
            <GeneratedValue
              value={
                courseHref ? (
                  <Link
                    href={courseHref as never}
                    className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                  >
                    <GeneratedText id="m_0ab383979f7a07" />
                  </Link>
                ) : null
              }
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveField
            id={id}
            field="completedOn"
            label={tGenerated('m_0afe74d8f3d4ea')}
            type="date"
            initialValue={initial.completedOn}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveField
            id={id}
            field="expiresOn"
            label={tGenerated('m_001b29133dcb72')}
            type="date"
            initialValue={initial.expiresOn}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveSelect
            id={id}
            field="source"
            label={tGenerated('m_1d05fa7a091a9b')}
            initialValue={initial.source}
            allowEmpty={false}
            options={SOURCE_OPTIONS}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveField
            id={id}
            field="grade"
            label={tGenerated('m_1f58a1228c4406')}
            type="number"
            initialValue={initial.grade}
            placeholder={tGenerated('m_0cadbe8ae1ae4e')}
            disabled={disabled}
            updateAction={updateAction}
          />
        </div>
        <LiveField
          id={id}
          field="instructor"
          label={tGenerated('m_0797e9a65b95e2')}
          initialValue={initial.instructor}
          placeholder={tGenerated('m_0db9a712b0e09a')}
          disabled={disabled}
          updateAction={updateAction}
        />
        <LiveField
          id={id}
          field="details"
          label={tGenerated('m_1560d4e2a09d09')}
          initialValue={initial.details}
          multiline
          rows={3}
          disabled={disabled}
          updateAction={updateAction}
        />
        <LiveField
          id={id}
          field="notes"
          label={tGenerated('m_0b8dadcb78cd08')}
          initialValue={initial.notes}
          multiline
          rows={3}
          disabled={disabled}
          updateAction={updateAction}
        />
      </CardContent>
    </Card>
  )
}
