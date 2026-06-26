'use client'

// Grouped permission picker for the role editor. Renders one real checkbox per
// catalogue permission (so the set posts as repeated `permissions` fields in a
// plain server-action form) while managing `checked` state in React to power
// the per-group and global "select all" shortcuts.

import { useMemo, useState } from 'react'
import { cn } from '@beaconhs/ui'
import { PERMISSION_GROUPS } from '@/lib/permissions-meta'

export function PermissionMatrix({
  name = 'permissions',
  defaultSelected = [],
  readOnly = false,
}: {
  name?: string
  defaultSelected?: string[]
  readOnly?: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected))
  const allKeys = useMemo(
    () => PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key)),
    [],
  )

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function setMany(keys: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  const allOn = selected.size === allKeys.length && allKeys.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {selected.size} of {allKeys.length} permissions
        </span>
        <button
          type="button"
          onClick={() => setMany(allKeys, !allOn)}
          disabled={readOnly}
          className={cn(
            'text-xs font-medium text-teal-700 hover:underline dark:text-teal-300',
            readOnly && 'cursor-not-allowed text-slate-400 hover:no-underline dark:text-slate-500',
          )}
        >
          {allOn ? 'Clear all' : 'Select all'}
        </button>
      </div>

      {PERMISSION_GROUPS.map((g) => {
        const keys = g.permissions.map((p) => p.key)
        const groupOn = keys.every((k) => selected.has(k))
        const groupSome = !groupOn && keys.some((k) => selected.has(k))
        return (
          <div
            key={g.key}
            className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {g.label}
                {groupSome ? (
                  <span className="ml-1.5 text-xs font-normal text-slate-400">partial</span>
                ) : null}
              </h3>
              <button
                type="button"
                onClick={() => setMany(keys, !groupOn)}
                disabled={readOnly}
                className={cn(
                  'text-xs font-medium text-teal-700 hover:underline dark:text-teal-300',
                  readOnly &&
                    'cursor-not-allowed text-slate-400 hover:no-underline dark:text-slate-500',
                )}
              >
                {groupOn ? 'Clear' : 'Select all'}
              </button>
            </div>
            <ul className="grid gap-x-4 gap-y-1 p-3 sm:grid-cols-2">
              {g.permissions.map((p) => {
                const on = selected.has(p.key)
                return (
                  <li key={p.key}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        readOnly && 'cursor-default',
                        on
                          ? 'text-slate-900 dark:text-slate-100'
                          : 'text-slate-600 dark:text-slate-400',
                        !readOnly && 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                      )}
                    >
                      <input
                        type="checkbox"
                        name={name}
                        value={p.key}
                        checked={on}
                        onChange={() => toggle(p.key)}
                        disabled={readOnly}
                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500/40 dark:border-slate-600 dark:bg-slate-800"
                      />
                      {p.label}
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
