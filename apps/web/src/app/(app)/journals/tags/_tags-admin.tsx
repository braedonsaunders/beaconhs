'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Journals → Tags admin surface. Lists every tag in the tenant (used ∪ defined)
// with usage counts + AI/user split, and lets admins create, recolour, describe,
// rename, merge, and delete tags. All mutations go through server actions that
// rewrite journal_entry_tags + the per-entry cache, and return the fresh list.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, GitMerge, Pencil, Plus, Sparkles, Tag as TagIcon, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, Input, Textarea, cn } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TAG_COLOR_KEYS, tagSwatch } from '../_tag-colors'
import { mergeTag, removeTag, saveTag, type TagActionResult } from './_actions'
import type { ManagedTag } from './_data'

const STATUS_OPTIONS = [
  { value: 'defined', label: 'Governed' },
  { value: 'ad_hoc', label: 'Ad-hoc' },
] as const

export function TagsAdmin({
  initialTags: tags,
  total,
  allTotal,
  totalUses,
  page,
  perPage,
  currentParams,
}: {
  initialTags: ManagedTag[]
  total: number
  allTotal: number
  totalUses: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function apply(res: TagActionResult, okMsg: string) {
    if (res.ok) {
      setCreating(false)
      setEditing(null)
      setMerging(null)
      toast.success(tGeneratedValue(okMsg))
      router.refresh()
    } else {
      toast.error(tGeneratedValue(res.error))
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
        <SearchInput placeholder={tGenerated('m_1ecc0f944484dc')} />
        <FilterChips
          basePath="/journals/tags"
          currentParams={currentParams}
          paramKey="status"
          label={tGenerated('m_074ba2f160c506')}
          options={[...STATUS_OPTIONS]}
        />
        <div className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
          <GeneratedValue value={allTotal} />{' '}
          <GeneratedValue
            value={
              allTotal === 1 ? (
                <GeneratedText id="m_0d850ab7d90993" />
              ) : (
                <GeneratedText id="m_0185291db43a8d" />
              )
            }
          />{' '}
          · <GeneratedValue value={totalUses} /> <GeneratedText id="m_07d97312448f9e" />
          <GeneratedValue value={totalUses === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />} />
        </div>
        <Button
          type="button"
          onClick={() => {
            setCreating((v) => !v)
            setEditing(null)
            setMerging(null)
          }}
        >
          <Plus size={15} /> <GeneratedText id="m_00566fa6f2f7f3" />
        </Button>
      </div>

      {/* Create composer */}
      <GeneratedValue
        value={
          creating ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <TagForm
                submitLabel={tGenerated('m_09bf9ab61bacab')}
                pending={pending}
                onSubmit={onCreate}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : null
        }
      />

      {/* List */}
      <GeneratedValue
        value={
          tags.length === 0 ? (
            <>
              <EmptyState
                icon={<TagIcon size={30} />}
                title={tGeneratedValue(
                  total > 0
                    ? tGenerated('m_12ad457b1d6d04')
                    : allTotal > 0
                      ? tGenerated('m_09f7b8c16c177d')
                      : tGenerated('m_156f36bd0e7922'),
                )}
                description={tGeneratedValue(
                  total > 0
                    ? tGenerated('m_19aaa5bd4312a9')
                    : allTotal > 0
                      ? tGenerated('m_13c87c8c217746')
                      : tGenerated('m_1c32ad1955d37f'),
                )}
              />
              <GeneratedValue
                value={
                  total > 0 ? (
                    <Pagination
                      basePath="/journals/tags"
                      currentParams={currentParams}
                      total={total}
                      page={page}
                      perPage={perPage}
                    />
                  ) : null
                }
              />
            </>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                <GeneratedValue
                  value={tags.map((t) =>
                    editing === t.name ? (
                      <li key={t.name} className="bg-slate-50/60 p-4 dark:bg-slate-800/40">
                        <TagForm
                          submitLabel={tGenerated('m_1ab9025ed1067c')}
                          pending={pending}
                          initial={{
                            name: t.name,
                            color: t.color,
                            description: t.description ?? '',
                          }}
                          onSubmit={(v) => onEdit(t.name, v)}
                          onCancel={() => setEditing(null)}
                        />
                      </li>
                    ) : merging === t.name ? (
                      <li key={t.name} className="bg-slate-50/60 p-4 dark:bg-slate-800/40">
                        <MergeRow
                          tag={t}
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
                />
              </ul>
              <Pagination
                basePath="/journals/tags"
                currentParams={currentParams}
                total={total}
                page={page}
                perPage={perPage}
              />
            </div>
          )
        }
      />
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
  const tGenerated = useGeneratedTranslations()
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
      <Chip name={tag.name} color={tag.color} />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <GeneratedValue
          value={
            tag.description ? (
              <span className="truncate text-sm text-slate-500 dark:text-slate-400">
                <GeneratedValue value={tag.description} />
              </span>
            ) : !tag.defined ? (
              <span className="text-xs text-slate-400 italic dark:text-slate-500">
                <GeneratedText id="m_1b4f992c7bf3cd" />
              </span>
            ) : null
          }
        />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <UsageMeter tag={tag} />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconBtn label={tGenerated('m_03a66f9d34ac7b')} onClick={onEdit} disabled={disabled}>
            <Pencil size={14} />
          </IconBtn>
          <IconBtn label={tGenerated('m_070c3cd186212d')} onClick={onMerge} disabled={disabled}>
            <GitMerge size={14} />
          </IconBtn>
          <IconBtn
            label={tGenerated('m_11773f3c3f7558')}
            danger
            onClick={onDelete}
            disabled={disabled}
          >
            <Trash2 size={14} />
          </IconBtn>
        </div>
      </div>
    </li>
  )
}

function UsageMeter({ tag }: { tag: ManagedTag }) {
  if (tag.usage === 0) {
    return (
      <span className="text-xs text-slate-400 dark:text-slate-500">
        <GeneratedText id="m_044bbea37f845d" />
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span className="font-medium text-slate-700 dark:text-slate-200">
        <GeneratedValue value={tag.usage} />
      </span>
      <GeneratedValue
        value={
          tag.usage === 1 ? (
            <GeneratedText id="m_0346fbefd51fb4" />
          ) : (
            <GeneratedText id="m_1743f903d5f1bc" />
          )
        }
      />
      <GeneratedValue
        value={
          tag.aiCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-teal-600/15 ring-inset dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/25">
              <Sparkles size={9} /> <GeneratedValue value={tag.aiCount} />
            </span>
          ) : null
        }
      />
    </span>
  )
}

// --- merge -----------------------------------------------------------------

function MergeRow({
  tag,
  pending,
  onMerge,
  onCancel,
}: {
  tag: ManagedTag
  pending: boolean
  onMerge: (target: string) => void
  onCancel: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  const [target, setTarget] = useState('')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span>
          <GeneratedText id="m_0859a766bb8938" />
        </span>
        <Chip name={tag.name} color={tag.color} />
        <span>
          <GeneratedText id="m_0c2434f34b9a38" />
        </span>
        <Input
          value={target}
          onChange={(event) => setTarget(event.target.value.toLowerCase())}
          aria-label={tGenerated('m_132ddef9c07840')}
          placeholder={tGenerated('m_052d4d1a952e24')}
          className="min-w-[12rem] flex-1"
        />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_099235a67a7117" />{' '}
        <strong>
          <GeneratedValue value={tag.name} />
        </strong>{' '}
        <GeneratedText id="m_0a3dfb1d2ec27d" />{' '}
        <strong>
          <GeneratedValue value={tag.name} />
        </strong>{' '}
        <GeneratedText id="m_0c379e20071551" />
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !target}
          onClick={() => onMerge(target)}
        >
          <GitMerge size={14} /> <GeneratedText id="m_0859a766bb8938" />
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-500 hover:underline dark:text-slate-400"
        >
          <GeneratedText id="m_112e2e8ecda428" />
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
  const tGenerated = useGeneratedTranslations()
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState<string | null>(initial?.color ?? null)
  const [description, setDescription] = useState(initial?.description ?? '')

  const clean = name.trim().toLowerCase()

  function submit() {
    if (!clean) {
      toast.error(tGenerated('m_10cab7aa536c63'))
      return
    }
    onSubmit({ name: clean, color, description: description.trim() || null })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1">
          <label className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
            <GeneratedText id="m_02b18d5c7f6f2d" />
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
            placeholder={tGenerated('m_1018d190cde1c3')}
            maxLength={40}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
            <GeneratedText id="m_11d37007232de5" />
          </label>
          <div className="flex h-10 items-center">
            <Chip name={clean || 'preview'} color={color} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
          <GeneratedText id="m_1242677f454516" />
        </label>
        <ColorSwatches value={color} onChange={setColor} />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
          <GeneratedText id="m_14d923495cf14c" />
          <GeneratedValue value={' '} />
          <span className="font-normal text-slate-400 normal-case dark:text-slate-500">
            <GeneratedText id="m_1f61ed87b795bd" />
          </span>
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder={tGenerated('m_04fd72e3562718')}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          <Check size={14} /> <GeneratedValue value={submitLabel} />
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-500 hover:underline dark:text-slate-400"
        >
          <GeneratedText id="m_112e2e8ecda428" />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <GeneratedValue
        value={TAG_COLOR_KEYS.map((key) => {
          const sw = tagSwatch(key)
          const active = (value ?? 'teal') === key
          return (
            <button
              key={key}
              type="button"
              aria-label={tGeneratedValue(sw.label)}
              aria-pressed={active}
              title={tGeneratedValue(sw.label)}
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
      />
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
      <span className="truncate">
        <GeneratedValue value={name} />
      </span>
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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={tGeneratedValue(label)}
      title={tGeneratedValue(label)}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-colors disabled:opacity-40 dark:text-slate-500',
        danger
          ? 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400'
          : 'hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300',
      )}
    >
      <GeneratedValue value={children} />
    </button>
  )
}
