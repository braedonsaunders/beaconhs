'use client'

// Full-width metadata/controls strip: date, log type, site, supervisor, and an
// editable tag chip set. Larger fields, generous spacing.

import { useState } from 'react'
import { Briefcase, CalendarDays, MapPin, Tag, UserCog } from 'lucide-react'
import { cn, SearchSelect } from '@beaconhs/ui'
import { TagEditor } from './_tag-editor'
import type { JournalDefinition, JournalEntryDetail, JournalOption, TagSuggestion } from './_types'

const FIELD =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900'

export function MetadataBar({
  entry,
  sites,
  people,
  tagSuggestions,
  editable,
  onPatch,
  onTagsChange,
}: {
  entry: JournalEntryDetail
  sites: JournalOption[]
  people: JournalOption[]
  tagSuggestions: TagSuggestion[]
  editable: boolean
  onPatch: (patch: {
    entryDate?: string
    definition?: JournalDefinition
    siteOrgUnitId?: string | null
    supervisorPersonId?: string | null
  }) => void
  onTagsChange: (tags: string[]) => void
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Date" icon={<CalendarDays size={13} />}>
          <input
            type="date"
            value={entry.entryDate}
            disabled={!editable}
            onChange={(e) => onPatch({ entryDate: e.target.value })}
            className={FIELD}
          />
        </Field>

        <Field label="Log type" icon={<Briefcase size={13} />}>
          <SearchSelect
            value={entry.definition}
            disabled={!editable}
            ariaLabel="Log type"
            sheetTitle="Log type"
            onChange={(v) => onPatch({ definition: v as JournalDefinition })}
            options={[
              { value: 'worker', label: 'Worker' },
              { value: 'supervisor', label: 'Supervisor' },
            ]}
          />
        </Field>

        <Field label="Location" icon={<MapPin size={13} />}>
          <SearchSelect
            value={entry.siteOrgUnitId ?? ''}
            disabled={!editable}
            clearable
            emptyLabel="No location"
            placeholder="No location"
            searchPlaceholder="Search locations…"
            sheetTitle="Location"
            ariaLabel="Location"
            onChange={(v) => onPatch({ siteOrgUnitId: v || null })}
            options={sites.map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>

        <Field label="Supervisor" icon={<UserCog size={13} />}>
          <SearchSelect
            value={entry.supervisorPersonId ?? ''}
            disabled={!editable}
            clearable
            emptyLabel="Unassigned"
            placeholder="Unassigned"
            searchPlaceholder="Search people…"
            sheetTitle="Supervisor"
            ariaLabel="Supervisor"
            onChange={(v) => onPatch({ supervisorPersonId: v || null })}
            options={people.map((p) => ({ value: p.id, label: p.name, hint: p.hint }))}
          />
        </Field>
      </div>

      {/* Tags — collapsed to a compact chip. Tagging is usually automatic in the
          background, so the input stays out of the way until tapped. */}
      <JournalTags
        tags={entry.tags}
        suggestions={tagSuggestions}
        editable={editable}
        onChange={onTagsChange}
      />
    </div>
  )
}

function Field({
  label,
  icon,
  children,
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span
        className={cn(
          'mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500',
        )}
      >
        {icon}
        {label}
      </span>
      {children}
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
  const [open, setOpen] = useState(false)

  if (open) {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
            <Tag size={12} /> Tags
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[11px] font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            Done
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
      title="Edit tags"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
    >
      <Tag size={13} className="shrink-0 text-slate-400 dark:text-slate-500" />
      {tags.length > 0 ? (
        <span className="truncate">{tags.join(' · ')}</span>
      ) : (
        <span>Add tags</span>
      )}
    </button>
  )
}
