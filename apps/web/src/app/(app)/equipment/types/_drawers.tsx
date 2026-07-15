'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Create / edit flyout for an equipment type. URL-driven (?drawer=new | <id>),
// one UrlDrawer + form handling both modes — mirrors /people/departments.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

export type TypeEditing = {
  id: string
  name: string
  description: string | null
  categoryId: string | null
}

type SaveAction = (input: {
  id?: string
  name: string
  description: string | null
  categoryId: string | null
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function EquipmentTypeDrawer({
  mode,
  editing,
  closeHref,
  categories,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: TypeEditing | null
  closeHref: string
  categories: { id: string; name: string }[]
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
        mode === 'edit' ? tGenerated('m_1cfe717d2103ec') : tGenerated('m_0a11a9b7f3edc8'),
      )}
      description={tGenerated('m_0f3f98d9b6074b')}
      size="md"
    >
      <TypeForm
        key={editing?.id ?? 'new'}
        editing={editing}
        categories={categories}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function TypeForm({
  editing,
  categories,
  saveAction,
  onDone,
}: {
  editing: TypeEditing | null
  categories: { id: string; name: string }[]
  saveAction: SaveAction
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [name, setName] = useState(editing?.name ?? '')
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

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
        categoryId: categoryId || null,
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
        <Label htmlFor="et-name">
          <GeneratedText id="m_1a9978900838e6" />
        </Label>
        <Input
          id="et-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={tGenerated('m_1b46f7fbe24fbd')}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="et-category">
          <GeneratedText id="m_108b41637f364f" />
        </Label>
        <Select
          id="et-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.currentTarget.value)}
        >
          <option value="">
            <GeneratedText id="m_0dd5f8a31ce3e1" />
          </option>
          <GeneratedValue
            value={categories.map((c) => (
              <option key={c.id} value={c.id}>
                <GeneratedValue value={c.name} />
              </option>
            ))}
          />
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="et-description">
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <Textarea
          id="et-description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={2}
        />
      </div>
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
                <GeneratedText id="m_043fe9fe859dff" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
