'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, XCircle, Zap } from 'lucide-react'
import { Button, cn } from '@beaconhs/ui'
import { testAiConnection } from '@/lib/ai-settings-actions'

export function AiTestButton({ scope }: { scope: 'tenant' | 'platform' }) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => start(async () => setResult(await testAiConnection({ scope })))}
      >
        <GeneratedValue
          value={
            pending ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Zap size={14} className="mr-1.5" />
            )
          }
        />
        <GeneratedText id="m_0b41b4284dc188" />
      </Button>
      <GeneratedValue
        value={
          result ? (
            <div
              className={cn(
                'flex items-start gap-2 rounded-md border p-2.5 text-sm',
                result.ok
                  ? 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/60 dark:bg-teal-950/50 dark:text-teal-200'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
              )}
            >
              <GeneratedValue
                value={
                  result.ok ? (
                    <CheckCircle2 size={15} className="mt-px shrink-0" />
                  ) : (
                    <XCircle size={15} className="mt-px shrink-0" />
                  )
                }
              />
              <span>
                <GeneratedValue value={result.message} />
              </span>
            </div>
          ) : null
        }
      />
    </div>
  )
}
