import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@beaconhs/ui'
import { LiveField, LivePersonSelect, LiveSelect } from '@/components/live-field'

// The skill "Skill details" card — the auto-saving field set for the unified
// assignment page. "New skill" creates the row immediately (default
// person/skill type) and lands here, where every field edits inline.

type SkillFieldValues = {
  personId: string
  skillTypeId: string
  grantedOn: string
  expiresOn: string | null
  notes: string | null
}

type SkillFieldOptions = {
  people: { id: string; firstName: string; lastName: string; employeeNo: string | null }[]
  skillTypes: { id: string; name: string; code: string | null; authorityName: string }[]
}

export function SkillDetailFields({
  id,
  initial,
  options,
  disabled,
  personHref,
  updateAction,
}: {
  id: string
  initial: SkillFieldValues
  options: SkillFieldOptions
  disabled?: boolean
  personHref?: string | null
  updateAction: (formData: FormData) => Promise<void>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Skill details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
        <LiveSelect
          id={id}
          field="skillTypeId"
          label="Skill / certification"
          initialValue={initial.skillTypeId}
          emptyLabel="Select a skill / certification…"
          options={options.skillTypes.map((t) => ({
            value: t.id,
            label: `${t.authorityName} · ${t.code ? `${t.code} · ` : ''}${t.name}`,
          }))}
          disabled={disabled}
          updateAction={updateAction}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveField
            id={id}
            field="grantedOn"
            label="Granted on"
            type="date"
            initialValue={initial.grantedOn}
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
        </div>
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
