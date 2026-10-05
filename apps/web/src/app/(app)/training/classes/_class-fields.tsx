import {
  GeneratedText,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
  GeneratedValue,
} from '@/i18n/generated'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, type SelectOption } from '@beaconhs/ui'
import { LiveField, LiveRemoteSelect, LiveSelect } from '@/components/live-field'
import { ClassSchedule } from './_class-schedule'

// The class "Class details" card — autosaving fields on the class record.

type ClassFieldValues = {
  courseId: string
  title: string
  startsAt: string // datetime-local string
  endsAt: string // datetime-local string
  siteOrgUnitId: string | null
  location: string | null
  instructorTenantUserId: string | null
  capacity: string | null
  notes: string | null
  reminderHours: string | null
}

type ClassFieldOptions = {
  course?: SelectOption
  site?: SelectOption
  instructor?: SelectOption
}

export function ClassDetailFields({
  id,
  initial,
  options,
  disabled,
  courseHref,
  notice,
  updateAction,
}: {
  id: string
  initial: ClassFieldValues
  options: ClassFieldOptions
  disabled?: boolean
  courseHref?: string | null
  notice?: React.ReactNode
  updateAction: (formData: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
  const tValue = useGeneratedValueTranslations()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedText id="m_1c674022b2b43f" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <GeneratedValue value={notice} />
        <div className="space-y-1">
          <LiveRemoteSelect
            id={id}
            field="courseId"
            label={tGenerated('m_14fc1e0739b60e')}
            initialValue={initial.courseId}
            initialOption={options.course}
            lookup="training-class-courses"
            allowEmpty={false}
            disabled={disabled}
            updateAction={updateAction}
          />
          <GeneratedValue
            value={
              courseHref ? (
                <Link
                  href={courseHref}
                  className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                >
                  <GeneratedText id="m_0ab383979f7a07" />
                </Link>
              ) : null
            }
          />
        </div>
        <LiveField
          id={id}
          field="title"
          label={tGenerated('m_0decefd558c355')}
          initialValue={initial.title}
          maxLength={200}
          disabled={disabled}
          updateAction={updateAction}
        />
        <ClassSchedule
          id={id}
          startsAt={initial.startsAt}
          endsAt={initial.endsAt}
          disabled={disabled}
          updateAction={updateAction}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveRemoteSelect
            id={id}
            field="siteOrgUnitId"
            label={tGenerated('m_1fc91567299335')}
            initialValue={initial.siteOrgUnitId}
            initialOption={options.site}
            lookup="training-class-sites"
            emptyLabel={tGenerated('m_13cf177934a5e3')}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveRemoteSelect
            id={id}
            field="instructorTenantUserId"
            label={tGenerated('m_0797e9a65b95e2')}
            initialValue={initial.instructorTenantUserId}
            initialOption={options.instructor}
            lookup="training-class-instructors"
            emptyLabel={tGenerated('m_176dd8fa7fc529')}
            disabled={disabled}
            updateAction={updateAction}
          />
        </div>
        <LiveField
          id={id}
          field="location"
          label={tValue('Class location')}
          initialValue={initial.location}
          maxLength={500}
          disabled={disabled}
          updateAction={updateAction}
        />
        <p className="text-xs text-slate-500">
          <GeneratedText id="m_1ceec74b520e0b" />
        </p>
        <LiveField
          id={id}
          field="capacity"
          label={tGenerated('m_0b57f1d8f70101')}
          initialValue={initial.capacity}
          type="number"
          min={1}
          max={1000}
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
          maxLength={20000}
          disabled={disabled}
          updateAction={updateAction}
        />
        <LiveSelect
          id={id}
          field="reminderHours"
          label={tValue('Automatic reminder email')}
          initialValue={initial.reminderHours}
          options={[
            { value: '24', label: tValue('1 day before class') },
            { value: '48', label: tValue('2 days before class') },
            { value: '168', label: tValue('1 week before class') },
          ]}
          emptyLabel={tValue('Off')}
          disabled={disabled}
          updateAction={updateAction}
        />
        <p className="text-xs text-slate-500">
          <GeneratedValue value="Reminders only send after a manager uses Email class. Creating or editing a class does not send its initial email." />
        </p>
      </CardContent>
    </Card>
  )
}
