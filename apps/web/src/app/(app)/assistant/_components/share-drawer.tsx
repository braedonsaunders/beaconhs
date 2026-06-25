'use client'

import { useEffect, useState, useTransition } from 'react'
import { Trash2, UserPlus } from 'lucide-react'
import { Badge, Button, Drawer, SearchSelect } from '@beaconhs/ui'
import {
  getShareData,
  shareAssistantConversation,
  unshareAssistantConversation,
  type ShareData,
} from '../_actions'

export function ShareDrawer({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string | null
  open: boolean
  onClose: () => void
}) {
  const [data, setData] = useState<ShareData | null>(null)
  const [targetType, setTargetType] = useState<'user' | 'role'>('user')
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    if (open && conversationId) {
      setData(null)
      setTargetId('')
      setError(null)
      getShareData(conversationId)
        .then(setData)
        .catch(() => setData({ shares: [], users: [], roles: [] }))
    }
  }, [open, conversationId])

  function refresh() {
    if (conversationId)
      getShareData(conversationId)
        .then(setData)
        .catch(() => {})
  }

  function add() {
    if (!conversationId || !targetId) return
    setError(null)
    start(async () => {
      const r = await shareAssistantConversation({ conversationId, targetType, targetId })
      if (!r.ok) setError(r.error ?? 'Could not share.')
      else {
        setTargetId('')
        refresh()
      }
    })
  }

  function remove(id: string) {
    start(async () => {
      await unshareAssistantConversation(id)
      refresh()
    })
  }

  const options =
    (targetType === 'user' ? data?.users : data?.roles)?.map((t) => ({
      value: t.id,
      label: t.name,
    })) ?? []

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Share conversation"
      description="People you share with can read this conversation. Only you can continue it."
      size="sm"
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            Shared with
          </div>
          {data && data.shares.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {data.shares.map((s) => (
                <Badge key={s.id} variant="secondary" className="gap-1.5 pr-1">
                  <span className="text-[10px] uppercase opacity-60">{s.type}</span>
                  {s.name}
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    disabled={pending}
                    className="rounded p-0.5 hover:bg-slate-300/50 dark:hover:bg-slate-600/50"
                    aria-label={`Remove ${s.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Not shared with anyone yet.
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            Add access
          </div>
          <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-800">
            {(['user', 'role'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTargetType(t)
                  setTargetId('')
                }}
                className={
                  'rounded px-3 py-1 text-sm font-medium transition-colors ' +
                  (targetType === t
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')
                }
              >
                {t === 'user' ? 'Person' : 'Role'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchSelect
                value={targetId}
                onChange={setTargetId}
                options={options}
                placeholder={targetType === 'user' ? 'Choose a person…' : 'Choose a role…'}
              />
            </div>
            <Button type="button" onClick={add} disabled={!targetId || pending}>
              <UserPlus className="h-4 w-4" />
              Add
            </Button>
          </div>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
      </div>
    </Drawer>
  )
}
