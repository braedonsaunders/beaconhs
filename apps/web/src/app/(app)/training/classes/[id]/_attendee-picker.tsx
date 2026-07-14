'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { toast } from '@/lib/toast'

export function ClassAttendeePicker({
  classId,
  action,
}: {
  classId: string
  action: (formData: FormData) => Promise<void>
}) {
  const router = useRouter()
  const [personId, setPersonId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    if (!personId) return
    setError(null)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('classId', classId)
      formData.set('personId', personId)
      try {
        await action(formData)
        setPersonId('')
        toast.success('Attendee added')
        router.refresh()
      } catch (actionError) {
        const message =
          actionError instanceof Error ? actionError.message : 'Could not add attendee.'
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <RemoteSearchSelect
            lookup="training-class-attendee-candidates"
            contextId={classId}
            value={personId}
            onChange={setPersonId}
            placeholder="Add a person to the roster…"
            searchPlaceholder="Search name, employee number, job title, or email…"
            sheetTitle="Add an attendee"
            ariaLabel="Person to add"
            clearable={false}
            disabled={pending}
          />
        </div>
        <Button type="button" onClick={add} disabled={!personId || pending}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </Button>
      </div>
      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  )
}
