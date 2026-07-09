'use client'

// Journals → Tags admin surface. Lists every tag in the tenant (used ∪ defined)
// with usage counts + AI/user split, and lets admins create, recolour, describe,
// rename, merge, and delete tags. All mutations go through server actions that
// rewrite journal_entry_tags + the per-entry cache, and return the fresh list.

import { useMemo, useState, useTransition } from 'react'
import {
  Check,
  GitMerge,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, Input, SearchSelect, Textarea, cn } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { TAG_COLOR_KEYS, tagSwatch } from '../_tag-colors'
import { mergeTag, removeTag, saveTag, type TagActionResult } from './_actions'
import type { ManagedTag } from './_data'

export function TagsAdmin({ initialTags }: { initialTags: ManagedTag[] }) {
  const [tags, setTags] = useState(initialTags)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      q ? tags.filter((t) => t.name.includes(q) || t.description?.toLowerCase().includes(q)) : tags,
    [tags, q],
  )
  const totalUses = useMemo(() => tags.reduce((n, t) => n + t.usage, 0), [tags])

  function apply(res: TagActionResult, okMsg: string) {
    if (res.ok) {
      setTags(res.tags)
      setCreating(false)
      setEditing(null)
      setMerging(null)
      toast.success(okMsg)
    } else {
      toast.error(res.error)
    }
  }

  function onCreate(values: TagFormValues) {
    startTransition(async () =>
      apply(await saveTag({ ...values, originalName: undefined }), `Added “${values.name}”`),
    )
  }
  function onEdit(original: string, values: TagFormValues) {
    startTransition(async () =>
      apply(await saveTag({ ...values, originalName: original }), `Saved “${values.name}”`),
    )
  }
  function onMerge(source: string, target: string) {
    startTransition(async () =>
      apply(await mergeTag({ source, target }), `Merged into “${target}”`),
    )
  }
  async function onDelete(name: string, usage: number) {
    const msg = usage
      ? `Delete “${name}” and remove it from ${usage} ${usage === 1 ? 'entry' : 'entries'}? This can’t be undone.`
      : `Delete “${name}”?`
    if (!(await confirmDialog({ message: msg, tone: 'danger' }))) return
    startTransition(async () => apply(await removeTag(name), `Deleted “${name}”`))
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={15}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags…"
            className="pl-9"
          />
        </div>
        <div className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
          {tags.length} {tags.length === 1 ? 'tag' : 'tags'} · {totalUses} use
          {totalUses === 1 ? '' : 's'}
        </div>
        <Button
          type="button"
          onClick={() => {
            setCreating((v) => !v)
            setEditing(null)
            setMerging(null)
          }}
        >
          <Plus size={15} /> New tag
        </Button>
      </div>

      {/* Create composer */}
      {creating ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <TagForm
            submitLabel="Add tag"
            pending={pending}
            onSubmit={onCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<TagIcon size={30} />}
          title={q ? 'No tags match' : 'No tags'}
          description={
            q
              ? 'Try a different search.'
              : 'Tags appear here as entries are tagged manually or by AI. Create one to predefine the vocabulary.'
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {filtered.map((t) =>
            editing === t.name ? (
              <li key={t.name} className="bg-slate-50/60 p-4 dark:bg-slate-800/40">
                <TagForm
                  submitLabel="Save changes"
                  pending={pending}
                  initial={{ name: t.name, color: t.color, description: t.description ?? '' }}
                  onSubmit={(v) => onEdit(t.name, v)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : merging === t.name ? (
              <li key={t.name} className="bg-slate-50/60 p-4 dark:bg-slate-800/40">
                <MergeRow
                  tag={t}
                  others={tags.filter((x) => x.name !== t.name)}
                  pending={pending}
                  onMerge={(target) => onMerge(t.name, target)}
                  onCancel={() => setMerging(null)}
                />
              </li>
            ) : (
              <TagRow
                key={t.name}
                tag={t}
                disabled={pending}
                onEdit={() => {
                  setEditing(t.name)
                  setMerging(null)
                  setCreating(false)
                }}
                onMerge={() => {
                  setMerging(t.name)
                  setEditing(null)
                  setCreating(false)
                }}
                onDelete={() => onDelete(t.name, t.usage)}
              />
            ),
          )}
        </ul>
      )}
    </div>
  )
}

// --- row -------------------------------------------------------------------

function TagRow({
  tag,
  disabled,
  onEdit,
  onMerge,
  onDelete,
}: {
  tag: ManagedTag
  disabled: boolean
  onEdit: () => void
  onMerge: () => void
  onDelete: () => void
}) {
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
      <Chip name={tag.name} color={tag.color} />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {tag.description ? (
          <span className="truncate text-sm text-slate-500 dark:text-slate-400">
            {tag.description}
          </span>
        ) : !tag.defined ? (
          <span className="text-xs text-slate-400 italic dark:text-slate-500">ad-hoc</span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <UsageMeter tag={tag} />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconBtn label="Edit" onClick={onEdit} disabled={disabled}>
            <Pencil size={14} />
          </IconBtn>
          <IconBtn label="Merge into…" onClick={onMerge} disabled={disabled}>
            <GitMerge size={14} />
          </IconBtn>
          <IconBtn label="Delete" danger onClick={onDelete} disabled={disabled}>
            <Trash2 size={14} />
          </IconBtn>
        </div>
      </div>
    </li>
  )
}

function UsageMeter({ tag }: { tag: ManagedTag }) {
  if (tag.usage === 0) {
    return <span className="text-xs text-slate-400 dark:text-slate-500">unused</span>
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span className="font-medium text-slate-700 dark:text-slate-200">{tag.usage}</span>
      {tag.usage === 1 ? 'entry' : 'entries'}
      {tag.aiCount > 0 ? (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-teal-600/15 ring-inset dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/25">
          <Sparkles size={9} /> {tag.aiCount}
        </span>
      ) : null}
    </span>
  )
}

// --- merge -----------------------------------------------------------------

function MergeRow({
  tag,
  others,
  pending,
  onMerge,
  onCancel,
}: {
  tag: ManagedTag
  others: ManagedTag[]
  pending: boolean
  onMerge: (target: string) => void
  onCancel: () => void
}) {
  const [target, setTarget] = useState('')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span>Merge</span>
        <Chip name={tag.name} color={tag.color} />
        <span>into</span>
        <div className="min-w-[12rem] flex-1">
          <SearchSelect
            value={target}
            onChange={setTarget}
            ariaLabel="Target tag"
            sheetTitle="Merge into"
            placeholder="Choose a tag…"
            searchPlaceholder="Search tags…"
            options={others.map((o) => ({ value: o.name, label: o.name }))}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Every entry tagged <strong>{tag.name}</strong> will be re-tagged to the target, and{' '}
        <strong>{tag.name}</strong> will be removed.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !target}
          onClick={() => onMerge(target)}
        >
          <GitMerge size={14} /> Merge
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-500 hover:underline dark:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// --- shared form -----------------------------------------------------------

type TagFormValues = { name: string; color: string | null; description: string | null }

function TagForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; color: string | null; description: string }
  submitLabel: string
  pending: boolean
  onSubmit: (values: TagFormValues) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState<string | null>(initial?.color ?? null)
  const [description, setDescription] = useState(initial?.description ?? '')

  const clean = name.trim().toLowerCase()

  function submit() {
    if (!clean) {
      toast.error('Tag name is required.')
      return
    }
    onSubmit({ name: clean, color, description: description.trim() || null })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1">
          <label className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
            Name
          </label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="e.g. scaffolding"
            maxLength={40}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
            Preview
          </label>
          <div className="flex h-10 items-center">
            <Chip name={clean || 'preview'} color={color} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
          Colour
        </label>
        <ColorSwatches value={color} onChange={setColor} />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
          Description{' '}
          <span className="font-normal text-slate-400 normal-case dark:text-slate-500">
            (optional)
          </span>
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What does this tag mean? Helps the team tag consistently."
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          <Check size={14} /> {submitLabel}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-500 hover:underline dark:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ColorSwatches({
  value,
  onChange,
}: {
  value: string | null
  onChange: (c: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TAG_COLOR_KEYS.map((key) => {
        const sw = tagSwatch(key)
        const active = (value ?? 'teal') === key
        return (
          <button
            key={key}
            type="button"
            aria-label={sw.label}
            aria-pressed={active}
            title={sw.label}
            onClick={() => onChange(key)}
            className={cn(
              'h-6 w-6 rounded-full ring-offset-2 transition dark:ring-offset-slate-900',
              sw.dot,
              active
                ? 'ring-2 ring-slate-900/40 dark:ring-white/50'
                : 'ring-1 ring-black/5 hover:ring-slate-400 dark:ring-white/10 dark:hover:ring-slate-500',
            )}
          />
        )
      })}
    </div>
  )
}

// --- bits ------------------------------------------------------------------

function Chip({ name, color }: { name: string; color: string | null }) {
  const sw = tagSwatch(color)
  return (
    <span
      className={cn(
        'inline-flex max-w-[16rem] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        sw.chip,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', sw.dot)} />
      <span className="truncate">{name}</span>
    </span>
  )
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-colors disabled:opacity-40 dark:text-slate-500',
        danger
          ? 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400'
          : 'hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300',
      )}
    >
      {children}
    </button>
  )
}
