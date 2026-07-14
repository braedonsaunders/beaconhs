'use client'

// Platform (super-admin) sidebar navigation. When the user is anywhere under
// /platform, the main left sidebar is REPLACED by these items (instead of the
// tenant module nav). A small static set — the platform area is fixed, not
// tenant-customisable. Consumed by AppSidebar, MobileNavToggle and MobileTabBar.

import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { SidebarNavGroup } from './sidebar-nav'

const PLATFORM_NAV_GROUPS: SidebarNavGroup[] = [
  {
    label: 'Platform',
    labelKey: 'Shell.platform',
    items: [
      {
        href: '/platform',
        label: 'Overview',
        labelKey: 'PlatformNav.overview',
        iconKey: 'grid',
        exact: true,
      },
      {
        href: '/platform/tenants',
        label: 'Tenants',
        labelKey: 'PlatformNav.tenants',
        iconKey: 'building',
        exact: true,
      },
      {
        href: '/platform/tenants/new',
        label: 'Create tenant',
        labelKey: 'PlatformNav.createTenant',
        iconKey: 'plus',
      },
      { href: '/platform/users', label: 'Users', labelKey: 'PlatformNav.users', iconKey: 'users' },
      {
        href: '/platform/email',
        label: 'Platform email',
        labelKey: 'PlatformNav.platformEmail',
        iconKey: 'mail',
      },
      {
        href: '/platform/sms',
        label: 'SMS provider',
        labelKey: 'PlatformNav.smsProvider',
        iconKey: 'message',
      },
      {
        href: '/platform/ai',
        label: 'AI provider',
        labelKey: 'PlatformNav.aiProvider',
        iconKey: 'sparkles',
      },
      {
        href: '/platform/email-log',
        label: 'Email log',
        labelKey: 'PlatformNav.emailLog',
        iconKey: 'scroll',
      },
      {
        href: '/platform/sms-log',
        label: 'SMS log',
        labelKey: 'PlatformNav.smsLog',
        iconKey: 'scroll',
      },
      {
        href: '/platform/database',
        label: 'Database maintenance',
        labelKey: 'PlatformNav.databaseMaintenance',
        iconKey: 'database',
      },
    ],
  },
]

/** True when the current route is part of the platform (super-admin) area. */
function useIsPlatform(): boolean {
  return (usePathname() ?? '').startsWith('/platform')
}

/** The nav groups to render: platform nav under /platform, else the tenant nav. */
export function useNavGroups(tenantGroups: SidebarNavGroup[]): SidebarNavGroup[] {
  const t = useTranslations()
  const groups = useIsPlatform() ? PLATFORM_NAV_GROUPS : tenantGroups
  return groups.map((group) => ({
    ...group,
    label: group.labelKey ? t(group.labelKey as never) : group.label,
    items: group.items.map((item) => ({
      ...item,
      label: item.labelKey ? t(item.labelKey as never) : item.label,
    })),
  }))
}
