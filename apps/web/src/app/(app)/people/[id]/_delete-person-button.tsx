'use client'

import { useTransition } from 'react'
import { unstable_rethrow, useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { flushRecordSaves } from '@/lib/pending-record-saves'
import { toast } from '@/lib/toast'
import { useGeneratedValueTranslations } from '@/i18n/generated'
import { deletePerson } from '../_actions/people'

export function DeletePersonButton({ id, synced }: { id: string; synced: boolean }) {
  const router = useRouter()
  const translate = useGeneratedValueTranslations()
  const [pending, start] = useTransition()
  const blocked = translate(
    'This person is managed by an external sync. Remove them in the source system.',
  )
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
      disabled={pending || synced}
      title={synced ? blocked : undefined}
      onClick={() => {
        start(async () => {
          const confirmed = await confirmDialog({
            title: translate('Delete person'),
            message: translate(
              'Remove this person from the directory and future selections? Existing safety records are kept. Their login account and workspace access are unchanged.',
            ),
            confirmLabel: translate('Delete person'),
            tone: 'danger',
          })
          if (!confirmed) return
          try {
            await flushRecordSaves()
            const result = await deletePerson(id)
            if (!result.ok) {
              toast.error(translate(result.error))
              return
            }
            router.push('/people')
          } catch (error) {
            unstable_rethrow(error)
            toast.error(
              error instanceof Error
                ? translate(error.message)
                : translate('Person could not be deleted.'),
            )
          }
        })
      }}
    >
      <Trash2 size={14} /> {translate(pending ? 'Deleting…' : 'Delete person')}
    </Button>
  )
}
