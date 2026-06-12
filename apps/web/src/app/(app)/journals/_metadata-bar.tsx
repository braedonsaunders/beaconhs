'use client'

// Full-width metadata/controls strip: date, log type, site, supervisor, and an
// editable tag chip set. Larger fields, generous spacing.

import { Briefcase, CalendarDays, MapPin, Tag, UserCog } from 'lucide-react'
import { cn, SearchSelect } from '@beaconhs/ui'
import { TagEditor } from './_tag-editor'
import type { JournalDefinition, JournalEntryDetail, JournalOption, TagSuggestion } from './_types'

const FIELD =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70'

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

        <Field label="Site" icon={<MapPin size={13} />}>
          <SearchSelect
            value={entry.siteOrgUnitId ?? ''}
            disabled={!editable}
            clearable
            emptyLabel="No site"
            placeholder="No site"
            searchPlaceholder="Search sites…"
            sheetTitle="Site"
            ariaLabel="Site"
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

      {/* Tags — full width */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
          <Tag size={12} /> Tags
        </div>
        <TagEditor
          tags={entry.tags}
          suggestions={tagSuggestions}
          editable={editable}
          onChange={onTagsChange}
          emptyHint="Add tags, or hit Summarise to auto-tag"
        />
      </div>
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
          'mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase',
        )}
      >
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}
