'use client'

import { useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Shared chrome for the app's "type builder" screens — a fixed 1/3 left rail
// (settings / palette) beside a flexible 2/3 build surface. Mirrors the
// app/form designer split so every builder feels the same.
//
// Drop <BuilderShell> inside a DetailPageLayout rendered with
// `className="h-full max-w-none p-0"` so it fills the viewport.

import * as React from 'react'
import { LayoutList, Settings2 } from 'lucide-react'

export function BuilderShell({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 lg:flex-row dark:bg-slate-950">
      <aside className="flex max-h-[48vh] min-h-0 w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-1/3 lg:max-w-md lg:min-w-[320px] lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-900">
        <GeneratedValue value={left} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <GeneratedValue value={right} />
      </div>
    </div>
  )
}

// Left-rail header strip: small square icon + title + subtitle.
export function BuilderRailHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
        <GeneratedValue value={icon} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedValue value={title} />
        </div>
        <GeneratedValue
          value={
            subtitle ? (
              <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue value={subtitle} />
              </div>
            ) : null
          }
        />
      </div>
    </div>
  )
}

// A small segmented tab bar for the left rail (Build / Settings / Activity).
export function BuilderRailTabs({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
      <GeneratedValue value={children} />
    </div>
  )
}

type BuilderRailView = 'build' | 'settings' | 'activity'

export function BuilderRailNavigation({
  active,
  onChange,
}: {
  active: BuilderRailView
  onChange: (view: BuilderRailView) => void
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <BuilderRailTabs>
      <BuilderRailTab
        active={active === 'build'}
        onClick={() => onChange('build')}
        icon={<LayoutList size={14} />}
        label={tGenerated('m_0adae4a94c7be3')}
      />
      <BuilderRailTab
        active={active === 'settings'}
        onClick={() => onChange('settings')}
        icon={<Settings2 size={14} />}
        label={tGenerated('m_151769a9fde954')}
      />
      <BuilderRailTab
        active={active === 'activity'}
        onClick={() => onChange('activity')}
        label={tGenerated('m_14b78af1b2f95e')}
      />
    </BuilderRailTabs>
  )
}

export function BuilderRailTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <GeneratedValue value={icon} />
      <GeneratedValue value={label} />
    </button>
  )
}

// Right-surface header strip: icon + title on the left, actions / badges right.
export function BuilderSurfaceHeader({
  icon,
  title,
  actions,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <GeneratedValue value={icon} />
        <GeneratedValue value={title} />
      </div>
      <GeneratedValue
        value={
          actions ? (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <GeneratedValue value={actions} />
            </div>
          ) : null
        }
      />
    </div>
  )
}

// Scroll container for either column's body.
export function BuilderScroll({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`app-scroll min-h-0 flex-1 overflow-y-auto p-4 ${className ?? ''}`}>
      <GeneratedValue value={children} />
    </div>
  )
}
