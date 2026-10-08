'use client'

import Link from 'next/link'
import { unwrapSigningResult } from '@/lib/hazid-signing-result'
import { unstable_rethrow, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Label, Textarea } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { RemoteMultiSelect } from '@/components/remote-multi-select'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import type { PickerOption } from '@/lib/picker-options'
import { toast } from '@/lib/toast'
import { addSigningCrew } from './_signing-actions'

export function AddCrewDrawerBody({
  assessmentId,
  closeHref,
}: {
  assessmentId: string
  closeHref: string
}) {
  const t = useGeneratedValueTranslations()
  const router = useRouter()
  const [selected, setSelected] = useState<PickerOption[]>([])
  const [groupId, setGroupId] = useState('')
  const [crewId, setCrewId] = useState('')
  const [externalNames, setExternalNames] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  function save() {
    setError(null)
    start(async () => {
      try {
        const count = unwrapSigningResult(
          await addSigningCrew({
            assessmentId,
            personIds: selected.map((p) => p.value),
            groupId: groupId || undefined,
            crewId: crewId || undefined,
            externalNames: externalNames.split('\n'),
          }),
        )
        toast.success(`${count} ${t('crew members added')}`)
        router.replace(closeHref as any, { scroll: false })
      } catch (err) {
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Could not add the crew')
      }
    })
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        <GeneratedValue value="Add everyone first, then collect their signatures together or request them on their own phones." />
      </p>
      <div className="space-y-2">
        <Label>
          <GeneratedValue value="People" />
        </Label>
        <RemoteMultiSelect
          lookup="hazard-assessment-signers"
          value={selected}
          onChange={setSelected}
          max={250}
          disabled={pending}
          placeholder={t('Add a person…')}
          ariaLabel="Add crew members"
        />
      </div>
      <div className="space-y-2">
        <Label>
          <GeneratedValue value="People group" />
        </Label>
        <RemoteSearchSelect
          lookup="hazard-assessment-signing-groups"
          value={groupId}
          onChange={setGroupId}
          disabled={pending}
          placeholder={t('Add a group…')}
          clearable
        />
      </div>
      <div className="space-y-2">
        <Label>
          <GeneratedValue value="Crew" />
        </Label>
        <RemoteSearchSelect
          lookup="hazard-assessment-signing-crews"
          value={crewId}
          onChange={setCrewId}
          disabled={pending}
          placeholder={t('Add a crew…')}
          clearable
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="external-signers">
          <GeneratedValue value="Visitors or contractors" />
        </Label>
        <Textarea
          id="external-signers"
          value={externalNames}
          onChange={(e) => setExternalNames(e.target.value)}
          disabled={pending}
          rows={3}
          placeholder={t('One name per line')}
        />
        <p className="text-xs text-slate-500">
          <GeneratedValue value="People without a linked BeaconHS account sign on this phone." />
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          <GeneratedValue value={error} />
        </p>
      ) : null}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-white py-3 dark:bg-slate-900">
        <Link href={closeHref as any}>
          <Button variant="outline" disabled={pending}>
            <GeneratedValue value="Cancel" />
          </Button>
        </Link>
        <Button
          onClick={save}
          disabled={pending || (!selected.length && !groupId && !crewId && !externalNames.trim())}
        >
          <GeneratedValue value={pending ? 'Saving…' : 'Add crew'} />
        </Button>
      </div>
    </div>
  )
}
