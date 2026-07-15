'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Generic name-only create/rename flyout for flat taxonomies (trades, crews, …).
// Opened via the URL (?drawer=new | ?drawer=<id>) so it survives refresh and is
// link-shareable. The save server action is passed in from the RSC page and
// returns {ok|error} for inline validation.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, UrlDrawer } from '@beaconhs/ui'

export type SaveResult = { ok: true } | { ok: false; error: string }

export type NameEditing = { id: string; name: string }

type SaveAction = (input: { id?: string; name: string }) => Promise<SaveResult>

export function NameDrawer({
  open,
  closeHref,
  noun,
  editing,
  saveAction,
}: {
  open: boolean
  closeHref: string
  /** Lowercase singular, e.g. "trade" or "crew". */
  noun: string
  editing: NameEditing | null
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
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        editing
          ? tGenerated('m_14fc22c8265a67', { value0: noun })
          : tGenerated('m_08e7bf7e603f55', { value0: noun }),
      )}
      description={tGeneratedValue(
        editing
          ? tGenerated('m_1a3669d966ff79', { value0: noun })
          : tGenerated('m_06009479ddfee6', { value0: noun }),
      )}
      size="sm"
    >
      <NameForm
        key={editing?.id ?? 'new'}
        noun={noun}
        editing={editing}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function NameForm({
  noun,
  editing,
  saveAction,
  onDone,
}: {
  noun: string
  editing: NameEditing | null
  saveAction: SaveAction
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [name, setName] = useState(editing?.name ?? '')
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
      const res = await saveAction({ id: editing?.id, name: trimmed })
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
        <Label htmlFor="name">
          <GeneratedText id="m_1a9978900838e6" />
        </Label>
        <Input
          id="name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={tGenerated('m_004a5064189e96', { value0: noun })}
          required
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
                <GeneratedText id="m_08e7bf7e603f55" values={{ value0: noun }} />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
