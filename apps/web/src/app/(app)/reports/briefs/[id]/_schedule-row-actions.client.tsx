'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Pause, Pencil, Play, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'
import { confirmDialog } from '@/lib/confirm'
import {
  deleteBriefSchedule,
  runBriefScheduleNow,
  setBriefScheduleActive,
} from '@/lib/briefs/actions'

export function ScheduleRowActions({
  id,
  active,
  editHref,
  canRun,
}: {
  id: string
  active: boolean
  editHref: string
  canRun: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()

  function act(work: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    start(async () => {
      const result = await work()
      if (!result.ok) {
        toast.error(tGeneratedValue(result.error))
        return
      }
      toast.success(tGeneratedValue(done))
      router.refresh()
    })
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {pending ? <Loader2 size={14} className="animate-spin text-slate-400" /> : null}
      <Link href={editHref as never} scroll={false}>
        <Button variant="ghost" size="icon" aria-label={tGenerated('m_00ec9d8b3bea44')}>
          <Pencil size={14} />
        </Button>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        aria-label={tGenerated('m_088d61d7784bcf')}
        title={tGenerated('m_1e320460f5b86d')}
        disabled={pending || !canRun}
        onClick={async () => {
          if (!(await confirmDialog(tGenerated('m_1ef7cfe6555bc9')))) return
          act(
            () => runBriefScheduleNow({ id }),
            'Brief queued — it will arrive in a minute or two.',
          )
        }}
      >
        <Send size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={active ? tGenerated('m_15f68d81e0bf4a') : tGenerated('m_1fd7f9ce965029')}
        disabled={pending}
        onClick={() =>
          act(
            () => setBriefScheduleActive({ id, active: !active }),
            active ? 'Schedule paused' : 'Schedule resumed',
          )
        }
      >
        {active ? <Pause size={14} /> : <Play size={14} />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={tGenerated('m_0a03115b30e12f')}
        disabled={pending}
        onClick={async () => {
          if (!(await confirmDialog(tGenerated('m_14288961e51fae')))) return
          act(() => deleteBriefSchedule({ id }), 'Schedule deleted')
        }}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  )
}
