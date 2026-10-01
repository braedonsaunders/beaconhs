'use client'

import { GeneratedValue } from '@/i18n/generated'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Select } from '@beaconhs/ui'
import { Loader2 } from 'lucide-react'
import { confirmDialog } from '@/lib/confirm'
import type { InstalledPluginAction, PluginActionResult } from '@/lib/tenant-plugins/types'

type ExecuteAction = (
  pluginId: string,
  actionId: string,
  fields: Record<string, string>,
) => Promise<PluginActionResult>
function TenantAction({
  action,
  disabled,
  execute,
}: {
  action: InstalledPluginAction
  disabled: boolean
  execute: ExecuteAction
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((action.fields ?? []).map((field) => [field.name, field.value ?? ''])),
  )
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  async function run() {
    if (action.confirm && !(await confirmDialog(action.confirm))) return
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await execute(action.pluginId, action.id, values)
        setMessage(result.ok ? result.message : result.error)
        if (result.ok) router.refresh()
      } catch {
        setMessage('Tenant extension failed. Please try again.')
      }
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(action.fields ?? [])
        .filter((field) => field.options.length > 1)
        .map((field) => (
          <Select
            key={field.name}
            aria-label={field.label}
            value={values[field.name] ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field.name]: event.target.value }))
            }
            disabled={disabled || pending}
            className="max-w-56"
          >
            <option value="">{field.label}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => void run()}
        disabled={disabled || pending || Boolean(action.disabledReason)}
        title={action.disabledReason ?? action.description}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : null}
        <GeneratedValue value={action.label} />
      </Button>
      {action.disabledReason ? (
        <span className="text-xs text-slate-500">
          <GeneratedValue value={action.disabledReason} />
        </span>
      ) : null}
      {message ? (
        <span role="status" className="text-xs text-slate-600 dark:text-slate-300">
          <GeneratedValue value={message} />
        </span>
      ) : null}
    </div>
  )
}
export function TenantPluginActions({
  actions,
  unavailable,
  disabled,
  execute,
}: {
  actions: InstalledPluginAction[]
  unavailable: boolean
  disabled: boolean
  execute: ExecuteAction
}) {
  return (
    <>
      {actions.map((action) => (
        <TenantAction
          key={`${action.pluginId}:${action.id}`}
          action={action}
          disabled={disabled}
          execute={execute}
        />
      ))}
      {unavailable ? (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-300">
          <GeneratedValue value="A tenant extension is unavailable. Contact your administrator." />
        </span>
      ) : null}
    </>
  )
}
