'use client'

import { useId, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import { Select } from '@beaconhs/ui'
import { SettingsNav } from '@braedonsaunders/appkit-ui'
import { NavIcon } from '@/components/sidebar-nav'
import { useGeneratedValueTranslations } from '@/i18n/generated'
import type { ModuleAdmin } from '@/lib/module-admin/registry'
import {
  groupModuleManagementSections,
  matchModuleManagementPath,
} from '@/lib/module-admin/navigation'

/** Shared chrome for the actual management routes, including direct deep links. */
export function ModuleManagementWorkspace({
  modules,
  children,
}: {
  modules: ModuleAdmin[]
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const selectId = useId()
  const t = useTranslations('ManageWorkspace')
  const translate = useGeneratedValueTranslations()
  const match = matchModuleManagementPath(modules, pathname)
  if (!match) return children

  const { module, section } = match
  const title = t('title', { module: translate(module.label) })
  const back = t('back', { module: translate(module.label) })
  const groups = groupModuleManagementSections(module.sections).map((group) => ({
    label: t(`groups.${group.label}`),
    items: group.items.map((item) => ({
      key: item.key,
      label: t(`pages.${item.label}`),
      icon: <NavIcon iconKey={item.iconKey} size={15} />,
    })),
  }))
  function select(key: string) {
    const next = module.sections.find((item) => item.key === key)
    if (next) router.push(next.href as never)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <aside
        aria-label={title}
        data-walkthrough="module-management-navigation"
        className="flex shrink-0 flex-col border-b border-slate-200 bg-white md:w-52 md:border-r md:border-b-0 lg:w-60 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="shrink-0 space-y-2 px-3 py-3 md:border-b md:border-slate-200 md:py-4 dark:md:border-slate-800">
          <Link
            href={module.href as never}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-teal-700 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:text-teal-300"
          >
            <ArrowLeft size={14} aria-hidden />
            {back}
          </Link>
          <h2 className="hidden text-sm font-semibold text-slate-900 md:block dark:text-slate-100">
            {title}
          </h2>
          <div className="space-y-1 md:hidden">
            <label
              htmlFor={selectId}
              className="text-xs font-medium text-slate-600 dark:text-slate-300"
            >
              {t('page')}
            </label>
            <Select
              id={selectId}
              aria-label={t('page')}
              sheetTitle={t('page')}
              value={section.key}
              onChange={(event) => select(event.target.value)}
              className="w-full text-sm"
            >
              {groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
        </div>
        <div className="app-scroll hidden min-h-0 flex-1 overflow-y-auto p-3 md:block">
          <SettingsNav groups={groups} activeKey={section.key} onSelect={select} />
        </div>
      </aside>
      {/* Pages own their headers, padding and scrolling. Keep the entire remaining
          height available to the flow canvas and print design studios. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  )
}
