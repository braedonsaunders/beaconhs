'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Add an org unit (customer / project / site / area) in a right-side flyout.
// Opened via the URL (?drawer=new) so it survives refresh and is link-shareable.
// The save server action is passed in from the RSC page and returns {ok|error}.
// Editing a unit's name/address happens on its own /locations/[id] page — this
// flyout is create-only.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, UrlDrawer } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'

type SaveResult = { ok: true } | { ok: false; error: string }

type LevelOption = { value: string; label: string }
export function OrgUnitDrawer({
  open,
  closeHref,
  levels,
  saveAction,
}: {
  open: boolean
  closeHref: string
  levels: LevelOption[]
  saveAction: (input: {
    name: string
    level: string
    parentId: string | null
  }) => Promise<SaveResult>
}) {
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
      title={tGenerated('m_1959406a59d28f')}
      description={tGenerated('m_1fc1d368544f40')}
      size="md"
    >
      <OrgUnitForm
        key={open ? 'open' : 'closed'}
        levels={levels}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function OrgUnitForm({
  levels,
  saveAction,
  onDone,
}: {
  levels: LevelOption[]
  saveAction: (input: {
    name: string
    level: string
    parentId: string | null
  }) => Promise<SaveResult>
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [name, setName] = useState('')
  const [level, setLevel] = useState(
    levels.find((l) => l.value === 'site')?.value ?? levels[0]?.value ?? '',
  )
  const [parentId, setParentId] = useState('')
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
      const res = await saveAction({ name: trimmed, level, parentId: parentId || null })
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
        <Label htmlFor="org-level">
          <GeneratedText id="m_1cc321f2024ad6" />
        </Label>
        <Select id="org-level" value={level} onChange={(e) => setLevel(e.currentTarget.value)}>
          {levels.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-parent">
          <GeneratedText id="m_14583b7cc6c6f9" />
        </Label>
        <RemoteSearchSelect
          lookup="location-parent-units"
          id="org-parent"
          value={parentId}
          onChange={setParentId}
          placeholder={tGenerated('m_195d867dcc670d')}
          searchPlaceholder={tGenerated('m_17490954225e7b')}
          sheetTitle="Select parent org unit"
          emptyLabel={tGenerated('m_195d867dcc670d')}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-name">
          <GeneratedText id="m_1a9978900838e6" />
        </Label>
        <Input
          id="org-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={tGenerated('m_0d18620cc9c690')}
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
          <GeneratedText id="m_1959406a59d28f" />
        </Button>
      </div>
    </form>
  )
}
