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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <LivePersonSelect
              id={id}
              field="personId"
              label="Person"
              initialValue={initial.personId}
              options={options.people.map((p) => ({
                value: p.id,
                label: `${p.lastName}, ${p.firstName}`,
                hint: p.employeeNo ?? undefined,
              }))}
              placeholder="Select a person…"
              searchPlaceholder="Search active people…"
              disabled={disabled}
              updateAction={updateAction}
            />
            {personHref ? (
              <Link
                href={personHref as never}
                className="text-xs text-teal-700 hover:underline dark:text-teal-400"
              >
                Open person page →
              </Link>
            ) : null}
          </div>
          <div className="space-y-1">
            <LiveSelect
              id={id}
              field="courseId"
              label="Course"
              initialValue={initial.courseId}
              emptyLabel="Select a course…"
              options={options.courses.map((c) => ({
                value: c.id,
                label: c.code ? `${c.code} · ${c.name}` : c.name,
              }))}
              disabled={disabled}
              updateAction={updateAction}
            />
            {courseHref ? (
              <Link
                href={courseHref as never}
                className="text-xs text-teal-700 hover:underline dark:text-teal-400"
              >
                Open course page →
              </Link>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveField
            id={id}
            field="completedOn"
            label="Completed on"
            type="date"
            initialValue={initial.completedOn}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveField
            id={id}
            field="expiresOn"
            label="Expires on"
            type="date"
            initialValue={initial.expiresOn}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveSelect
            id={id}
            field="source"
            label="Source"
            initialValue={initial.source}
            allowEmpty={false}
            options={SOURCE_OPTIONS}
            disabled={disabled}
            updateAction={updateAction}
          />
          <LiveField
            id={id}
            field="grade"
            label="Grade %"
            type="number"
            initialValue={initial.grade}
            placeholder="Optional"
            disabled={disabled}
            updateAction={updateAction}
          />
        </div>
        <LiveField
          id={id}
          field="instructor"
          label="Instructor"
          initialValue={initial.instructor}
          placeholder="Instructor or evaluator"
          disabled={disabled}
          updateAction={updateAction}
        />
        <LiveField
          id={id}
          field="details"
          label="Details"
          initialValue={initial.details}
          multiline
          rows={3}
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
          disabled={disabled}
          updateAction={updateAction}
        />
      </CardContent>
    </Card>
  )
}
