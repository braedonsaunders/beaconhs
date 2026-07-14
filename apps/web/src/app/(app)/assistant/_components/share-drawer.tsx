'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Trash2, UserPlus } from 'lucide-react'
import { Badge, Button, Drawer } from '@beaconhs/ui'
import { RemoteSearchSelect, type RemoteSearchLoader } from '@/components/remote-search-select'
import {
  getShareData,
  loadAssistantShareTargets,
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
    let active = true
    if (open && conversationId) {
      getShareData(conversationId)
        .then((next) => {
          if (!active) return
          setData(next)
          setError(null)
        })
        .catch(() => {
          if (active) setError('Sharing settings could not be loaded.')
        })
    }
    return () => {
      active = false
    }
  }, [open, conversationId])

  function close() {
    setData(null)
    setTargetId('')
    setError(null)
    onClose()
  }

  const refresh = useCallback(async () => {
    if (!conversationId) return
    try {
      setData(await getShareData(conversationId))
      setError(null)
    } catch {
      setError('Sharing settings could not be refreshed.')
    }
  }, [conversationId])

  const loadOptions = useCallback<RemoteSearchLoader>(
    ({ query, selected }) =>
      conversationId
        ? loadAssistantShareTargets({ conversationId, targetType, query, selected })
        : Promise.resolve({ options: [], hasMore: false }),
    [conversationId, targetType],
  )

  function add() {
    if (!conversationId || !targetId) return
    setError(null)
    start(async () => {
      try {
        const r = await shareAssistantConversation({ conversationId, targetType, targetId })
        if (!r.ok) setError(r.error ?? 'Could not share.')
        else {
          setTargetId('')
          await refresh()
        }
      } catch {
        setError('Could not share this conversation.')
      }
    })
  }

  function remove(id: string) {
    start(async () => {
      try {
        await unshareAssistantConversation(id)
        await refresh()
      } catch {
        setError('Could not remove access from this conversation.')
      }
    })
  }

  return (
    <Drawer
      open={open}
      onClose={close}
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
          ) : data ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Not shared with anyone yet.
            </p>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading sharing…</p>
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
              <RemoteSearchSelect
                key={`${targetType}:${data?.shares.map((share) => share.id).join(',') ?? ''}`}
                value={targetId}
                onChange={setTargetId}
                loadOptions={loadOptions}
                placeholder={targetType === 'user' ? 'Choose a person…' : 'Choose a role…'}
                searchPlaceholder={targetType === 'user' ? 'Search people…' : 'Search roles…'}
                sheetTitle={targetType === 'user' ? 'Choose a person' : 'Choose a role'}
                ariaLabel={targetType === 'user' ? 'Person to share with' : 'Role to share with'}
                disabled={!conversationId || !data || pending}
              />
            </div>
            <Button type="button" onClick={add} disabled={!targetId || pending}>
              <UserPlus className="h-4 w-4" />
              Add
            </Button>
          </div>
          {error && data ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
      </div>
    </Drawer>
  )
}
