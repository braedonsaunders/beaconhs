import { GeneratedValue } from '@/i18n/generated'
import { Activity, Check, Pencil, Plus, Signature, Trash2 } from 'lucide-react'
import { DEFAULT_LOCALE, type AppLocale } from '@beaconhs/i18n'

type ActivityEntry = {
  id: string
  action: string
  summary?: string | null
  actor?: string | null
  occurredAt: Date | string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

const ACTION_ICONS: Record<string, { icon: typeof Activity; tone: string }> = {
  create: { icon: Plus, tone: 'bg-emerald-100 text-emerald-700' },
  update: { icon: Pencil, tone: 'bg-amber-100 text-amber-700' },
  delete: { icon: Trash2, tone: 'bg-red-100 text-red-700' },
  sign: { icon: Signature, tone: 'bg-teal-100 text-teal-700' },
  publish: { icon: Check, tone: 'bg-teal-100 text-teal-700' },
}

export function ActivityFeed({
  entries,
  timeZone,
  locale = DEFAULT_LOCALE,
}: {
  entries: ActivityEntry[]
  timeZone: string
  locale?: AppLocale
}) {
  const copy = COPY[locale]
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
        <GeneratedValue value={copy.empty} />
      </div>
    )
  }
  return (
    <ol className="relative space-y-3 pl-6">
      <span
        className="absolute top-2 bottom-2 left-2.5 w-px bg-slate-200 dark:bg-slate-700"
        aria-hidden
      />
      <GeneratedValue
        value={entries.map((e) => {
          const meta = ACTION_ICONS[e.action] ?? {
            icon: Activity,
            tone: 'bg-slate-100 text-slate-600',
          }
          const Icon = meta.icon
          return (
            <li key={e.id} className="relative">
              <span
                className={`absolute top-0 -left-6 flex h-5 w-5 items-center justify-center rounded-full ${meta.tone}`}
              >
                <Icon size={11} />
              </span>
              <div className="rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    <GeneratedValue value={e.summary ?? humanise(e.action)} />
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={formatRel(e.occurredAt, timeZone, locale)} />
                  </span>
                </div>
                <GeneratedValue
                  value={
                    e.actor ? (
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue value={copy.by} /> <GeneratedValue value={e.actor} />
                      </div>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    e.after && Object.keys(e.after).length > 0 ? (
                      <details className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                        <summary className="cursor-pointer text-slate-500 select-none hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                          <GeneratedValue value={copy.showChanges} />
                        </summary>
                        <dl className="mt-2 space-y-2">
                          {Object.entries(e.after)
                            .filter(
                              ([key, value]) =>
                                !['id', 'rowId'].includes(key) &&
                                JSON.stringify(e.before?.[key]) !== JSON.stringify(value),
                            )
                            .map(([key, value]) => (
                              <div key={key} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                                <dt className="font-medium">
                                  {humanise(key.replace(/([a-z])([A-Z])/g, '$1 $2'))}
                                </dt>
                                <dd className="break-words whitespace-pre-wrap">
                                  {e.before && key in e.before ? (
                                    <>
                                      <span className="text-slate-500">
                                        {displayValue(e.before[key], timeZone, locale)}
                                      </span>{' '}
                                      →{' '}
                                    </>
                                  ) : null}
                                  {displayValue(value, timeZone, locale)}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      </details>
                    ) : null
                  }
                />
              </div>
            </li>
          )
        })}
      />
    </ol>
  )
}

function humanise(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatRel(d: Date | string, timeZone: string, locale: AppLocale): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const ms = Date.now() - date.getTime()
  const mins = Math.round(ms / 60_000)
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (mins < 1) return relative.format(0, 'minute')
  if (mins < 60) return relative.format(-mins, 'minute')
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return relative.format(-hrs, 'hour')
  const days = Math.round(hrs / 24)
  if (days < 30) return relative.format(-days, 'day')
  return date.toLocaleDateString(locale, { timeZone })
}

const COPY: Record<AppLocale, { empty: string; by: string; showChanges: string }> = {
  en: { empty: 'No activity recorded yet.', by: 'by', showChanges: 'show changes' },
  fr: {
    empty: 'Aucune activité enregistrée.',
    by: 'par',
    showChanges: 'afficher les modifications',
  },
  es: {
    empty: 'Aún no hay actividad registrada.',
    by: 'por',
    showChanges: 'mostrar cambios',
  },
}

function displayValue(value: unknown, timeZone: string, locale: string): string {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value))
    return value.length ? value.map((v) => displayValue(v, timeZone, locale)).join(', ') : 'None'
  if (typeof value === 'object')
    return Object.entries(value)
      .map(([k, v]) => `${humanise(k)}: ${displayValue(v, timeZone, locale)}`)
      .join(' · ')
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
    return new Date(value).toLocaleString(locale, { timeZone })
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/_/g, ' ')
}
