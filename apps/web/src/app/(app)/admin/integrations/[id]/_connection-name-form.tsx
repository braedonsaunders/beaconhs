'use client'

import { useActionState } from 'react'
import { Button } from '@beaconhs/ui'
import { renameConnection, type RenameConnectionState } from '../_actions'
import { StatusPill } from '../_pills'
import { INTEGRATION_CONNECTION_NAME_MAX_LENGTH } from '@/lib/persisted-text-policy'

const INITIAL_STATE: RenameConnectionState = { status: 'idle' }

export function ConnectionNameForm({
  id,
  name,
  status,
}: {
  id: string
  name: string
  status: string
}) {
  const [state, action, pending] = useActionState(renameConnection, INITIAL_STATE)
  const savedName = state.status === 'success' ? state.name : name

  return (
    <form action={action} className="mt-1">
      <div className="flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <input
          key={savedName}
          name="name"
          defaultValue={savedName}
          maxLength={INTEGRATION_CONNECTION_NAME_MAX_LENGTH}
          required
          aria-label="Connection name"
          aria-describedby="connection-name-status"
          className="max-w-[16rem] min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-2xl font-semibold text-slate-900 hover:border-slate-200 focus:border-teal-400 focus:bg-white focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-900"
        />
        <StatusPill status={status} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={pending}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p
        id="connection-name-status"
        aria-live="polite"
        className={`mt-1 text-xs ${
          state.status === 'error'
            ? 'text-red-600 dark:text-red-400'
            : 'text-emerald-600 dark:text-emerald-400'
        }`}
      >
        {state.status === 'error'
          ? state.error
          : state.status === 'success'
            ? 'Connection name saved.'
            : '\u00a0'}
      </p>
    </form>
  )
}
