'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Channel × category matrix editor. The initial state is hydrated from the
// notification_preferences rows on disk; any (category, channel) combo without
// a row defaults to enabled (matches dispatcher behaviour).

import { useMemo, useState, useTransition } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from './_constants'
import { saveNotificationPreferences } from './actions'

type Cell = { category: NotificationCategory; channel: NotificationChannel; enabled: boolean }

export function PreferencesForm({ initial }: { initial: Cell[] }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const initialMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const c of initial) m.set(`${c.category}:${c.channel}`, c.enabled)
    return m
  }, [initial])

  const [state, setState] = useState<Record<string, boolean>>(() => {
    const obj: Record<string, boolean> = {}
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const channel of NOTIFICATION_CHANNELS) {
        const key = `${category}:${channel}`
        obj[key] = initialMap.has(key) ? initialMap.get(key)! : true
      }
    }
    return obj
  })
  const [pending, startTransition] = useTransition()

  function toggle(category: NotificationCategory, channel: NotificationChannel) {
    const key = `${category}:${channel}`
    setState((s) => ({ ...s, [key]: !s[key] }))
  }

  function save() {
    const prefs: Cell[] = []
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const channel of NOTIFICATION_CHANNELS) {
        prefs.push({ category, channel, enabled: state[`${category}:${channel}`] ?? true })
      }
    }
    startTransition(async () => {
      const res = await saveNotificationPreferences({ prefs })
      if (res.ok) {
        toast.success(tGenerated('m_1c87b580610c45'))
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0278951c14f8a4')))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wider text-slate-500 uppercase dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">
                <GeneratedText id="m_108b41637f364f" />
              </th>
              <GeneratedValue
                value={NOTIFICATION_CHANNELS.map((ch) => (
                  <th key={ch} className="px-4 py-3 text-center font-medium">
                    <GeneratedValue value={CHANNEL_LABELS[ch]} />
                  </th>
                ))}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            <GeneratedValue
              value={NOTIFICATION_CATEGORIES.map((category) => {
                const meta = CATEGORY_LABELS[category]
                return (
                  <tr key={category}>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        <GeneratedValue value={meta.title} />
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue value={meta.description} />
                      </div>
                    </td>
                    <GeneratedValue
                      value={NOTIFICATION_CHANNELS.map((channel) => {
                        const key = `${category}:${channel}`
                        const checked = state[key] ?? true
                        return (
                          <td key={channel} className="px-4 py-3 text-center align-top">
                            <label className="inline-flex cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-teal-700 focus:ring-teal-600 dark:border-slate-700 dark:text-teal-400"
                                checked={checked}
                                onChange={() => toggle(category, channel)}
                                aria-label={tGenerated('m_088c617bb509a4', {
                                  value0: meta.title,
                                  value1: CHANNEL_LABELS[channel],
                                })}
                              />
                            </label>
                          </td>
                        )
                      })}
                    />
                  </tr>
                )
              })}
            />
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_0f7558da0e44a6" />
        </p>
        <Button type="button" onClick={save} disabled={pending}>
          <GeneratedValue
            value={
              pending ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Save size={14} className="mr-1.5" />
              )
            }
          />
          <GeneratedText id="m_1e4be3ab19587f" />
        </Button>
      </div>
    </div>
  )
}
