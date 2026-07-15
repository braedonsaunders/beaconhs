'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Shared publish/unpublish control for Insights cards and dashboards. Publishing
// opens a role picker so the publisher can restrict the published asset to
// specific roles (allowedRoles); leaving every role unchecked shares it with
// everyone who can view Insights. This is the single writer for the
// allowedRoles column that canSeePublishedInsight enforces on the read side.

import { useState } from 'react'
import { Globe, Loader2, Lock } from 'lucide-react'
import { Button, Popover } from '@beaconhs/ui'

export type PublishRoleOption = { key: string; name: string }

export function PublishControl({
  status,
  roles,
  initialAllowedRoles,
  pending,
  onPublish,
  onUnpublish,
  buttonVariant = 'outline',
  buttonClassName = 'h-9 text-xs',
}: {
  status: 'draft' | 'published'
  roles: PublishRoleOption[]
  initialAllowedRoles: string[] | null
  pending: boolean
  /** Called with the selected role keys, or null for "everyone". */
  onPublish: (allowedRoles: string[] | null) => void
  onUnpublish: () => void
  buttonVariant?: 'outline' | 'ghost'
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialAllowedRoles ?? []))

  if (status === 'published') {
    return (
      <Button
        type="button"
        variant={buttonVariant}
        onClick={onUnpublish}
        disabled={pending}
        className={buttonClassName}
      >
        <GeneratedValue
          value={
            pending ? (
              <Loader2 size={13} className="mr-1 animate-spin" />
            ) : (
              <Lock size={13} className="mr-1" />
            )
          }
        />
        <GeneratedText id="m_0d6976fc2d60c8" />
      </Button>
    )
  }

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const restricted = selected.size > 0

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <Button
          type="button"
          variant={buttonVariant}
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          className={buttonClassName}
        >
          <GeneratedValue
            value={
              pending ? (
                <Loader2 size={13} className="mr-1 animate-spin" />
              ) : (
                <Globe size={13} className="mr-1" />
              )
            }
          />
          <GeneratedText id="m_0c072fb8baf115" />
        </Button>
      }
      className="w-72 p-3"
    >
      <div className="space-y-2.5">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_12ab47c364c4db" />
          </h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_0854ce0ec48eb9" />
          </p>
        </div>
        <div
          className={`rounded-md border px-2.5 py-1.5 text-xs ${
            restricted
              ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
          }`}
        >
          <GeneratedValue
            value={
              restricted ? (
                <GeneratedText
                  id="m_1f688129a274f7"
                  values={{ value0: selected.size, value1: selected.size === 1 ? '' : 's' }}
                />
              ) : (
                <GeneratedText id="m_1452f24ba8370a" />
              )
            }
          />
        </div>
        <GeneratedValue
          value={
            roles.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_008f5a3d7812ab" />
              </p>
            ) : (
              <ul className="app-scroll max-h-52 space-y-1 overflow-y-auto">
                <GeneratedValue
                  value={roles.map((r) => (
                    <li key={r.key}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/60">
                        <input
                          type="checkbox"
                          checked={selected.has(r.key)}
                          onChange={() => toggle(r.key)}
                        />
                        <span className="flex-1 truncate">
                          <GeneratedValue value={r.name} />
                        </span>
                      </label>
                    </li>
                  ))}
                />
              </ul>
            )
          }
        />
        <Button
          type="button"
          onClick={() => {
            setOpen(false)
            onPublish(restricted ? Array.from(selected) : null)
          }}
          disabled={pending}
          className="h-8 w-full text-xs"
        >
          <Globe size={13} className="mr-1" /> <GeneratedText id="m_0c072fb8baf115" />
        </Button>
      </div>
    </Popover>
  )
}
