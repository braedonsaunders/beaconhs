'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Full-width metadata/controls strip: date, log type, site, supervisor, and an
// editable tag chip set. Larger fields, generous spacing. Each control is a
// local-first record field owned by the editor pane (see ./_editor-pane.tsx).

import { useState } from 'react'
import { Briefcase, CalendarDays, MapPin, Tag } from 'lucide-react'
import { cn, SearchSelect } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { RecordFieldError } from '@/components/record-field-error'
import type { RecordFieldHandle } from '@/lib/offline-drafts/offline-record'
import type { PickerOption } from '@/lib/picker-options'
import { TagEditor } from './_tag-editor'
import { JournalSupervisorField } from './_supervisor-field'
import { canonicalJournalTags } from './_tag-policy'
import type { JournalDefinition, TagSuggestion } from './_types'

const FIELD =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900'

/** The entry's metadata fields, bound by the editor pane (wire values: '' = none). */
export type JournalMetadataFields = {
  entryDate: RecordFieldHandle<string>
  definition: RecordFieldHandle<JournalDefinition>
  siteOrgUnitId: RecordFieldHandle<string>
  supervisorPersonId: RecordFieldHandle<string>
  tags: RecordFieldHandle<string[]>
}

export function MetadataBar({
  fields,
  tagSuggestions,
  editable,
  requiredForSubmission,
  siteOption,
  supervisorOption,
}: {
  fields: JournalMetadataFields
  tagSuggestions: TagSuggestion[]
  editable: boolean
  requiredForSubmission: boolean
  /** Saved location/supervisor labels, shown without waiting on a lookup. */
  siteOption?: PickerOption
  supervisorOption?: PickerOption
}) {
  const tGenerated = useGeneratedTranslations()
  const { entryDate, definition, siteOrgUnitId, supervisorPersonId, tags } = fields
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field
          label={tGenerated('m_0285c38761c540')}
          icon={<CalendarDays size={13} />}
          error={entryDate.error}
        >
          <input
            type="date"
            value={entryDate.value}
            disabled={!editable}
            // A journal always has a date: a cleared or half-typed date is not saved.
            onChange={(e) => {
              if (e.target.value) entryDate.commit(e.target.value)
            }}
            className={FIELD}
          />
        </Field>

        <Field
          label={tGenerated('m_0d55dd6f409ab0')}
          icon={<Briefcase size={13} />}
          error={definition.error}
        >
          <SearchSelect
            value={definition.value}
            disabled={!editable}
            ariaLabel="Log type"
            sheetTitle="Log type"
            onChange={(v) => definition.commit(v as JournalDefinition)}
            options={[
              { value: 'worker', label: 'Worker' },
              { value: 'supervisor', label: 'Supervisor' },
            ]}
          />
        </Field>

        <Field
          label={tGenerated('m_055f11420b2da4')}
          icon={<MapPin size={13} />}
          error={siteOrgUnitId.error}
          required={requiredForSubmission}
          hint={
            requiredForSubmission && !siteOrgUnitId.value ? (
              <GeneratedValue value={'Choose a location before submitting your journal.'} />
            ) : null
          }
        >
          <RemoteSearchSelect
            lookup="journal-locations"
            value={siteOrgUnitId.value}
            initialOption={siteOption}
            disabled={!editable}
            clearable
            emptyLabel={tGenerated('m_1ad901c0a1f003')}
            placeholder={tGenerated('m_1ad901c0a1f003')}
            searchPlaceholder={tGenerated('m_016e087c3c8544')}
            sheetTitle="Location"
            ariaLabel={requiredForSubmission ? 'Location (required for submission)' : 'Location'}
            onChange={(v) => siteOrgUnitId.commit(v || '')}
          />
        </Field>

        <div className="space-y-1">
          <JournalSupervisorField
            value={supervisorPersonId.value || null}
            initialOption={supervisorOption}
            disabled={!editable}
            requiredForSubmission={requiredForSubmission}
            onChange={(value) => supervisorPersonId.commit(value ?? '')}
          />
          <RecordFieldError error={supervisorPersonId.error} />
        </div>
      </div>

      {/* Tags — collapsed to a compact chip. Tagging is usually automatic in the
          background, so the input stays out of the way until tapped. */}
      <JournalTags
        tags={tags.value}
        suggestions={tagSuggestions}
        editable={editable}
        onChange={(next) => tags.commit(canonicalJournalTags(next))}
      />
      <RecordFieldError error={tags.error} />
    </div>
  )
}

function Field({
  label,
  icon,
  error,
  required = false,
  hint = null,
  children,
}: {
  label: string
  icon?: React.ReactNode
  error: string | null
  required?: boolean
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500',
        )}
      >
        <GeneratedValue value={icon} />
        <GeneratedValue value={label} />
        {required ? <span aria-hidden="true">*</span> : null}
      </span>
      <GeneratedValue value={children} />
      {hint ? <p className="text-xs text-amber-700 dark:text-amber-300">{hint}</p> : null}
      <RecordFieldError error={error} />
    </label>
  )
}

/**
 * Collapsed tag control — a compact chip that expands to the full editor on tap.
 * Tags are usually applied automatically (background AI), so the input stays out
 * of the way until someone wants to adjust them.
 */
function JournalTags({
  tags,
  suggestions,
  editable,
  onChange,
}: {
  tags: string[]
  suggestions: TagSuggestion[]
  editable: boolean
  onChange: (tags: string[]) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const [open, setOpen] = useState(false)

  if (open) {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
            <Tag size={12} /> <GeneratedText id="m_168fcd8afec105" />
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[11px] font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            <GeneratedText id="m_00609f822e0571" />
          </button>
        </div>
        <TagEditor
          tags={tags}
          suggestions={suggestions}
          editable={editable}
          onChange={onChange}
          emptyHint="Add a tag…"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => editable && setOpen(true)}
      disabled={!editable}
      title={tGenerated('m_0de3a819ff17b3')}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
    >
      <Tag size={13} className="shrink-0 text-slate-400 dark:text-slate-500" />
      <GeneratedValue
        value={
          tags.length > 0 ? (
            <span className="truncate">
              <GeneratedValue value={tags.join(' · ')} />
            </span>
          ) : (
            <span>
              <GeneratedText id="m_07eab83cc03cc2" />
            </span>
          )
        }
      />
    </button>
  )
}
