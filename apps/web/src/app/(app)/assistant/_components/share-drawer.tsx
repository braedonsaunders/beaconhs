'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
          setError(tGeneratedValue(null))
        })
        .catch(() => {
          if (active) setError(tGenerated('m_1e0b668b253157'))
        })
    }
    return () => {
      active = false
    }
  }, [open, conversationId, tGeneratedValue, tGenerated])

  function close() {
    setData(null)
    setTargetId('')
    setError(tGeneratedValue(null))
    onClose()
  }

  const refresh = useCallback(async () => {
    if (!conversationId) return
    try {
      setData(await getShareData(conversationId))
      setError(tGeneratedValue(null))
    } catch {
      setError(tGenerated('m_1b98813d7cdfa4'))
    }
  }, [conversationId, tGenerated, tGeneratedValue])

  const loadOptions = useCallback<RemoteSearchLoader>(
    ({ query, selected }) =>
      conversationId
        ? loadAssistantShareTargets({ conversationId, targetType, query, selected })
        : Promise.resolve({ options: [], hasMore: false }),
    [conversationId, targetType],
  )

  function add() {
    if (!conversationId || !targetId) return
    setError(tGeneratedValue(null))
    start(async () => {
      try {
        const r = await shareAssistantConversation({ conversationId, targetType, targetId })
        if (!r.ok) setError(tGeneratedValue(r.error ?? tGenerated('m_099394533fe8f4')))
        else {
          setTargetId('')
          await refresh()
        }
      } catch {
        setError(tGenerated('m_1ab66156c323e4'))
      }
    })
  }

  function remove(id: string) {
    start(async () => {
      try {
        await unshareAssistantConversation(id)
        await refresh()
      } catch {
        setError(tGenerated('m_12d0f3a5f4e0ca'))
      }
    })
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title={tGenerated('m_05d51467f1bb41')}
      description={tGenerated('m_1450cd9ea57307')}
      size="sm"
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            <GeneratedText id="m_1d0444f639d487" />
          </div>
          <GeneratedValue
            value={
              data && data.shares.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <GeneratedValue
                    value={data.shares.map((s) => (
                      <Badge key={s.id} variant="secondary" className="gap-1.5 pr-1">
                        <span className="text-[10px] uppercase opacity-60">
                          <GeneratedValue value={s.type} />
                        </span>
                        <GeneratedValue value={s.name} />
                        <button
                          type="button"
                          onClick={() => remove(s.id)}
                          disabled={pending}
                          className="rounded p-0.5 hover:bg-slate-300/50 dark:hover:bg-slate-600/50"
                          aria-label={tGenerated('m_101f98a70352fa', { value0: s.name })}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  />
                </div>
              ) : data ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_006210d01458fe" />
                </p>
              ) : error ? (
                <div className="space-y-2">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    <GeneratedValue value={error} />
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
                    <GeneratedText id="m_060f1ed88b3989" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_12d57d54c557c4" />
                </p>
              )
            }
          />
        </div>

        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            <GeneratedText id="m_087ea743a2eea3" />
          </div>
          <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-800">
            <GeneratedValue
              value={(['user', 'role'] as const).map((t) => (
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
                  <GeneratedValue
                    value={
                      t === 'user' ? (
                        <GeneratedText id="m_12e926c9216094" />
                      ) : (
                        <GeneratedText id="m_1099c1fe8b6614" />
                      )
                    }
                  />
                </button>
              ))}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <RemoteSearchSelect
                key={`${targetType}:${data?.shares.map((share) => share.id).join(',') ?? ''}`}
                value={targetId}
                onChange={setTargetId}
                loadOptions={loadOptions}
                placeholder={tGeneratedValue(
                  targetType === 'user'
                    ? tGenerated('m_0c0d8d4b86c7c4')
                    : tGenerated('m_0944ae3b1f9cca'),
                )}
                searchPlaceholder={tGeneratedValue(
                  targetType === 'user'
                    ? tGenerated('m_0b842b664b4f3b')
                    : tGenerated('m_1421e5a75849c1'),
                )}
                sheetTitle={targetType === 'user' ? 'Choose a person' : 'Choose a role'}
                ariaLabel={targetType === 'user' ? 'Person to share with' : 'Role to share with'}
                disabled={!conversationId || !data || pending}
              />
            </div>
            <Button type="button" onClick={add} disabled={!targetId || pending}>
              <UserPlus className="h-4 w-4" />
              <GeneratedText id="m_16c8592e5020a4" />
            </Button>
          </div>
          <GeneratedValue
            value={
              error && data ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  <GeneratedValue value={error} />
                </p>
              ) : null
            }
          />
        </div>
      </div>
    </Drawer>
  )
}
