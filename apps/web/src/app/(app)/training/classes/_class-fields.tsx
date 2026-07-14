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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Class details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice}
        <div className="space-y-1">
          <LiveRemoteSelect
            id={id}
            field="courseId"
            label="Course"
            initialValue={initial.courseId}
            initialOption={options.course}
            lookup="training-class-courses"
            allowEmpty={false}
            disabled={disabled}
            updateAction={updateAction}
          />
          {courseHref ? (
            <Link
              href={courseHref}
              className="text-xs text-teal-700 hover:underline dark:text-teal-400"
            >
              Open course page →
            </Link>
          ) : null}
        </div>
        <LiveField
          id={id}
          field="title"
          label="Title"
          initialValue={initial.title}
          maxLength={200}
          disabled={disabled}
          updateAction={updateAction}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveDateTime
            id={id}
            field="startsAt"
            label="Starts at"
            initialValue={initial.startsAt}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveDateTime
            id={id}
            field="endsAt"
            label="Ends at"
            initialValue={initial.endsAt}
            disabled={disabled}
            updateAction={updateAction}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveRemoteSelect
            id={id}
            field="siteOrgUnitId"
            label="Site (location)"
            initialValue={initial.siteOrgUnitId}
            initialOption={options.site}
            lookup="training-class-sites"
            emptyLabel="— No site —"
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveRemoteSelect
            id={id}
            field="instructorTenantUserId"
            label="Instructor"
            initialValue={initial.instructorTenantUserId}
            initialOption={options.instructor}
            lookup="training-class-instructors"
            emptyLabel="— No instructor —"
            disabled={disabled}
            updateAction={updateAction}
          />
        </div>
        <LiveField
          id={id}
          field="capacity"
          label="Max attendees"
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
          label="Notes"
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
