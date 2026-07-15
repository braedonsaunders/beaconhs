'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Create / edit an incident classification in a right-side flyout. Opened via
// the URL (?drawer=new[&parent=<id>] | ?drawer=<id>) so it survives refresh and
// is link-shareable. The save server action is passed in from the RSC page.
//
// Parent is chosen only when creating — re-parenting an existing node is not
// supported (it would orphan TRIR rollups), so the field is hidden on edit.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'

export type ClassificationEditing = {
  id: string
  name: string
  code: string | null
  description: string | null
  isRecordable: boolean
}

type SaveAction = (input: {
  id?: string
  parentId: string | null
  name: string
  code: string | null
  description: string | null
  isRecordable: boolean
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function ClassificationDrawer({
  mode,
  editing,
  defaultParentId,
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: ClassificationEditing | null
  defaultParentId: string
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
        mode === 'edit' ? tGenerated('m_119bb2466c7625') : tGenerated('m_1bab4688751c07'),
      )}
      description={tGeneratedValue(
        mode === 'edit' ? tGenerated('m_1e6d11ed184ba0') : tGenerated('m_1544b00ad1ee70'),
      )}
      size="md"
    >
      <ClassificationForm
        key={editing?.id ?? `new:${defaultParentId}`}
        editing={editing}
        defaultParentId={defaultParentId}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function ClassificationForm({
  editing,
  defaultParentId,
  saveAction,
  onDone,
}: {
  editing: ClassificationEditing | null
  defaultParentId: string
  saveAction: SaveAction
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [parentId, setParentId] = useState(defaultParentId)
  const [name, setName] = useState(editing?.name ?? '')
  const [code, setCode] = useState(editing?.code ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [isRecordable, setIsRecordable] = useState(editing?.isRecordable ?? true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    const trimmed = name.trim()
    if (!trimmed) {
      setError(tGenerated('m_1c66cb30434189'))
      return
    }
    startTransition(async () => {
      const res = await saveAction({
        id: editing?.id,
        parentId: editing ? null : parentId || null,
        name: trimmed,
        code: code.trim() || null,
        description: description.trim() || null,
        isRecordable,
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
      <GeneratedValue
        value={
          editing ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="cl-parent">
                <GeneratedText id="m_14583b7cc6c6f9" />
              </Label>
              <RemoteSearchSelect
                id="cl-parent"
                lookup="incident-classification-parents"
                value={parentId}
                onChange={setParentId}
                placeholder={tGenerated('m_11b75c428eea23')}
                searchPlaceholder={tGenerated('m_169ba0a4ef26ba')}
                sheetTitle="Select parent classification"
                ariaLabel="Parent classification"
                clearable
                emptyLabel={tGenerated('m_07b15a5d41e454')}
              />
            </div>
          )
        }
      />

      <div className="space-y-1.5">
        <Label htmlFor="cl-name">
          <GeneratedText id="m_1a9978900838e6" />
        </Label>
        <Input
          id="cl-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={tGenerated('m_0b5a2216e47943')}
          required
          maxLength={200}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cl-code">
          <GeneratedText id="m_0570e24c85cf95" />
        </Label>
        <Input
          id="cl-code"
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          placeholder={tGenerated('m_027c1ffdcf1d80')}
          maxLength={6}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={isRecordable}
          onChange={(e) => setIsRecordable(e.currentTarget.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <GeneratedText id="m_12020f802ae6e8" />
      </label>

      <div className="space-y-1.5">
        <Label htmlFor="cl-description">
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <Textarea
          id="cl-description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={3}
          placeholder={tGenerated('m_1db68018f67929')}
          maxLength={10000}
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
                <GeneratedText id="m_0c361c2cb6146b" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
