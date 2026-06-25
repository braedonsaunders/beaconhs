'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, Send, XCircle } from 'lucide-react'
import { Button, Input, cn } from '@beaconhs/ui'
import { testSmsConnection } from '@/lib/sms-settings-actions'

export function SmsTestButton({
  scope,
  defaultTo = '',
}: {
  scope: 'tenant' | 'platform'
  defaultTo?: string
}) {
  const [to, setTo] = useState(defaultTo)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            type="tel"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+15551234567"
            aria-label="Test recipient phone number"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !to}
          onClick={() => start(async () => setResult(await testSmsConnection({ scope, to })))}
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
