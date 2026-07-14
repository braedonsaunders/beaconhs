'use client'

// Light / dark / system switcher. Expanded: a 3-way segmented control. Collapsed
// (icon-rail sidebar): a single button showing the active mode that cycles
// light → dark → system. Renders an inert placeholder until mounted so the SSR
// markup (which can't know the stored preference) doesn't mismatch on hydration.

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@beaconhs/ui'
import { useTheme, type Theme } from './theme-provider'

const OPTIONS: { value: Theme; icon: typeof Sun; labelKey: 'light' | 'system' | 'dark' }[] = [
  { value: 'light', icon: Sun, labelKey: 'light' },
  { value: 'system', icon: Monitor, labelKey: 'system' },
  { value: 'dark', icon: Moon, labelKey: 'dark' },
]

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme, mounted } = useTheme()
  const t = useTranslations('Shell')

  if (collapsed) {
    const active = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[1]!
    const Icon = active.icon
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    return (
      <button
        type="button"
        onClick={() => setTheme(next)}
        title={t('themeModeChange', { mode: t(active.labelKey) })}
        aria-label={t('themeMode', { mode: t(active.labelKey) })}
        className="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        {mounted ? <Icon size={16} /> : <Monitor size={16} className="opacity-0" />}
      </button>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('theme')}
      className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/60"
    >
      {OPTIONS.map((o) => {
        const Icon = o.icon
        const selected = mounted && theme === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(o.value)}
            title={t(o.labelKey)}
            className={cn(
              'inline-flex h-7 flex-1 items-center justify-center rounded-md transition-colors',
              selected
                ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            <Icon size={15} />
          </button>
        )
      })}
    </div>
  )
}
