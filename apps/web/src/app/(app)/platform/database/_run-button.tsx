'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, PlayCircle, XCircle } from 'lucide-react'
import { Button, cn } from '@beaconhs/ui'
import { runMaintenanceNow } from './_actions'

export function RunMaintenanceButton() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => start(async () => setResult(await runMaintenanceNow()))}
      >
        {pending ? (
          <Loader2 size={14} className="mr-1.5 animate-spin" />
        ) : (
          <PlayCircle size={14} className="mr-1.5" />
        )}
        Run maintenance now
      </Button>
      {result ? (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border p-2.5 text-sm',
            result.ok
              ? 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/60 dark:bg-teal-950/50 dark:text-teal-200'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
          )}
        >
          {result.ok ? (
            <CheckCircle2 size={15} className="mt-px shrink-0" />
          ) : (
            <XCircle size={15} className="mt-px shrink-0" />
          )}
          <span>{result.message}</span>
        </div>
      ) : null}
    </div>
  )
}
