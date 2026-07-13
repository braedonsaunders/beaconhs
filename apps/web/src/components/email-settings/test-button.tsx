'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, Send, XCircle } from 'lucide-react'
import { Button, Input, cn } from '@beaconhs/ui'
import { testEmailConnection } from '@/lib/email-settings-actions'

export function EmailTestButton({
  scope,
  defaultTo = '',
  disabled = false,
}: {
  scope: 'tenant' | 'platform'
  defaultTo?: string
  disabled?: boolean
}) {
  const [to, setTo] = useState(defaultTo)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            type="email"
            value={to}
            disabled={disabled}
            maxLength={254}
            onChange={(event) => {
              setTo(event.target.value)
              setResult(null)
            }}
            placeholder="you@example.com"
            aria-label="Test recipient"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || pending || !to}
          onClick={() => start(async () => setResult(await testEmailConnection({ scope, to })))}
        >
          {pending ? (
            <Loader2 size={14} className="mr-1.5 animate-spin" />
          ) : (
            <Send size={14} className="mr-1.5" />
          )}
          Send test
        </Button>
      </div>
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
