'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Create / edit an injury type in a right-side flyout. Opened via the URL
// (?drawer=new | ?drawer=<id>) so it survives refresh and is link-shareable.
// The save server action is passed in from the RSC list page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'

type InjuryTypeEditing = {
  id: string
  name: string
  oshaCode: string | null
  description: string | null
}

type SaveAction = (input: {
  id?: string
  name: string
  oshaCode: string | null
  description: string | null
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function InjuryTypeDrawer({
  mode,
  editing,
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: InjuryTypeEditing | null
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
        mode === 'edit' ? tGenerated('m_0b89fef54f9bea') : tGenerated('m_0e487713d94f19'),
      )}
      description={tGeneratedValue(
        mode === 'edit' ? tGenerated('m_049defd3527f87') : tGenerated('m_187bb67ef35b68'),
      )}
      size="md"
    >
      <InjuryTypeForm
        key={editing?.id ?? 'new'}
        editing={editing}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function InjuryTypeForm({
  editing,
  saveAction,
  onDone,
}: {
  editing: InjuryTypeEditing | null
  saveAction: SaveAction
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [name, setName] = useState(editing?.name ?? '')
  const [oshaCode, setOshaCode] = useState(editing?.oshaCode ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
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
        name: trimmed,
        oshaCode: oshaCode.trim() || null,
        description: description.trim() || null,
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
        <Label htmlFor="it-name">
          <GeneratedText id="m_1a9978900838e6" />
        </Label>
        <Input
          id="it-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={tGenerated('m_1bbfd5e4cf03eb')}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="it-osha">
          <GeneratedText id="m_1321e20f44dd66" />
        </Label>
        <Input
          id="it-osha"
          value={oshaCode}
          onChange={(e) => setOshaCode(e.currentTarget.value)}
          placeholder={tGenerated('m_1b749876767935')}
          maxLength={8}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="it-description">
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <Textarea
          id="it-description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={3}
          placeholder={tGenerated('m_1db68018f67929')}
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
                <GeneratedText id="m_19de387f77eda1" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
