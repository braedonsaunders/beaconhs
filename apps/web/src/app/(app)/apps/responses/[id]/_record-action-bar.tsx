'use client'

// Configurable record-action buttons for the unified Builder-app record page.
// Each button is a `manual`-trigger Flow (authored in the designer's Actions
// tab). Clicking runs that flow through the shared executor via `runRecordAction`
// and refreshes the page so any spawned records / status changes show up.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  FileText,
  Mail,
  Play,
  Plus,
  Send,
  ShieldAlert,
  Zap,
} from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { runRecordAction } from './_record-action-actions'

type RecordActionButton = {
  flowId: string
  buttonId: string
  label: string
  icon?: string
  variant?: 'default' | 'outline' | 'destructive' | 'secondary'
  confirm?: string
}

// Map a small set of common lucide names authored on the button. Unknown / unset
// icons render without a glyph — deliberately simple.
const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  'alert-triangle': AlertTriangle,
  bell: Bell,
  'check-circle-2': CheckCircle2,
  'check-circle': CheckCircle2,
  'file-text': FileText,
  mail: Mail,
  play: Play,
  plus: Plus,
  send: Send,
  'shield-alert': ShieldAlert,
  zap: Zap,
}

function RecordActionButtonItem({
  responseId,
  button,
}: {
  responseId: string
  button: RecordActionButton
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const Icon = button.icon ? ICONS[button.icon] : undefined

  function run() {
    if (button.confirm && !window.confirm(button.confirm)) return
    setStatus('idle')
    setMessage(null)
    startTransition(async () => {
      const res = await runRecordAction({
        responseId,
        flowId: button.flowId,
        buttonId: button.buttonId,
      })
      if (res.ok) {
        setStatus('done')
        setMessage(null)
        router.refresh()
      } else {
        setStatus('error')
        setMessage(res.error ?? 'Action failed')
      }
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant={button.variant ?? 'outline'} onClick={run} disabled={pending}>
        {Icon ? <Icon size={14} /> : null} {button.label}
      </Button>
      {pending ? (
        <span className="text-xs text-slate-500 dark:text-slate-400">Running…</span>
      ) : status === 'done' ? (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">Done</span>
      ) : status === 'error' ? (
        <span className="text-xs text-red-600 dark:text-red-400">{message}</span>
      ) : null}
    </span>
  )
}

export function RecordActionBar({
  responseId,
  buttons,
}: {
  responseId: string
  buttons: RecordActionButton[]
}) {
  if (buttons.length === 0) return null
  return (
    <>
      {buttons.map((b) => (
        <RecordActionButtonItem
          key={`${b.flowId}:${b.buttonId}`}
          responseId={responseId}
          button={b}
        />
      ))}
    </>
  )
}
