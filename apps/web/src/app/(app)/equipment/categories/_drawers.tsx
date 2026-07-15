'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Create / edit flyout for an equipment category. URL-driven (?drawer=new | <id>),
// one UrlDrawer + form handling both modes — mirrors /people/departments.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'
import { DEFAULT_ENABLED_GROUP_KEYS, EQUIPMENT_FIELD_GROUPS } from '@/lib/equipment/field-groups'

export type CategoryEditing = {
  id: string
  name: string
  description: string | null
  sortOrder: number
  enabledFieldGroups: string[] | null
}

type SaveAction = (input: {
  id?: string
  name: string
  description: string | null
  sortOrder: number
  enabledFieldGroups: string[] | null
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function EquipmentCategoryDrawer({
  mode,
  editing,
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: CategoryEditing | null
  closeHref: string
  saveAction: SaveAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  return (
    <UrlDrawer
      open={mode !== null}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'edit' ? tGenerated('m_0a97c82f86c7fd') : tGenerated('m_1736ef0672df5e'),
      )}
      description={tGenerated('m_009586c9023493')}
      size="md"
    >
      <CategoryForm
        key={editing?.id ?? 'new'}
        editing={editing}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function CategoryForm({
  editing,
  saveAction,
  onDone,
}: {
  editing: CategoryEditing | null
  saveAction: SaveAction
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [name, setName] = useState(editing?.name ?? '')
  const [sortOrder, setSortOrder] = useState(String(editing?.sortOrder ?? 0))
  const [description, setDescription] = useState(editing?.description ?? '')
  // Field-group layout — the checkbox list is always shown; a category that
  // was never configured starts from the registry defaults.
  const [groupKeys, setGroupKeys] = useState<string[]>(
    editing?.enabledFieldGroups ?? DEFAULT_ENABLED_GROUP_KEYS,
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggleGroup(key: string) {
    setGroupKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  }

  function submit() {
    setError(tGeneratedValue(null))
    const trimmed = name.trim()
    if (!trimmed) {
      setError(tGenerated('m_1c66cb30434189'))
      return
    }
    start(async () => {
      const res = await saveAction({
        id: editing?.id,
        name: trimmed,
        description: description.trim() || null,
        sortOrder: Number(sortOrder) || 0,
        enabledFieldGroups: groupKeys,
      })
      if (res.ok) onDone()
      else setError(tGeneratedValue(res.error))
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="ec-name">
          <GeneratedText id="m_1a9978900838e6" />
        </Label>
        <Input
          id="ec-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={tGenerated('m_09406a888fff35')}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ec-sort">
          <GeneratedText id="m_1e92b40de46761" />
        </Label>
        <Input
          id="ec-sort"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.currentTarget.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ec-description">
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <Textarea
          id="ec-description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={2}
        />
      </div>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_022980e3d36543" />
        </legend>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_0bc3773a49fb31" />
        </p>
        <div className="space-y-1.5">
          <GeneratedValue
            value={EQUIPMENT_FIELD_GROUPS.map((g) => (
              <label key={g.key} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={groupKeys.includes(g.key)}
                  onChange={() => toggleGroup(g.key)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
                />
                <span>
                  <GeneratedValue value={g.label} />
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={g.description} />
                  </span>
                </span>
              </label>
            ))}
          />
        </div>
      </fieldset>
      <GeneratedValue
        value={
          error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          <GeneratedText id="m_112e2e8ecda428" />
        </Button>
        <Button type="submit" disabled={pending}>
          <GeneratedValue
            value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          />
          <GeneratedValue
            value={
              editing ? (
                <GeneratedText id="m_1ab9025ed1067c" />
              ) : (
                <GeneratedText id="m_1f5e21b0218fd8" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
