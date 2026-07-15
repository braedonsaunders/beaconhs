import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, type SelectOption } from '@beaconhs/ui'
import { LiveDateTime, LiveField, LiveRemoteSelect } from '@/components/live-field'

// The class "Class details" card — the auto-saving field set shared by the
// record page (id present) and the lazy /new page (id omitted; the row is
// created on first edit via LazyRecordProvider).

type ClassFieldValues = {
  courseId: string
  title: string
  startsAt: string // datetime-local string
  endsAt: string // datetime-local string
  siteOrgUnitId: string | null
  instructorTenantUserId: string | null
  capacity: string | null
  notes: string | null
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
  /** Omit for a new (lazy) record — the row is created on first save. */
  id?: string
  initial: ClassFieldValues
  options: ClassFieldOptions
  disabled?: boolean
  courseHref?: string | null
  notice?: React.ReactNode
  updateAction: (formData: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveDateTime
            id={id}
            field="startsAt"
            label={tGenerated('m_1fbd4c28375213')}
            initialValue={initial.startsAt}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveDateTime
            id={id}
            field="endsAt"
            label={tGenerated('m_1c40705ea1aabf')}
            initialValue={initial.endsAt}
            disabled={disabled}
            updateAction={updateAction}
          />
        </div>
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
      </CardContent>
    </Card>
  )
}
