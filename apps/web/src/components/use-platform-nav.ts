'use client'

// Platform (super-admin) sidebar navigation. When the user is anywhere under
// /platform, the main left sidebar is REPLACED by these items (instead of the
// tenant module nav). A small static set — the platform area is fixed, not
// tenant-customisable. Consumed by AppSidebar, MobileNavToggle and MobileTabBar.

import { usePathname } from 'next/navigation'
import type { SidebarNavGroup } from './sidebar-nav'

const PLATFORM_NAV_GROUPS: SidebarNavGroup[] = [
  {
    label: 'Platform',
    items: [
      { href: '/platform', label: 'Overview', iconKey: 'grid', exact: true },
      { href: '/platform/tenants', label: 'Tenants', iconKey: 'building', exact: true },
      { href: '/platform/tenants/new', label: 'Create tenant', iconKey: 'plus' },
      { href: '/platform/users', label: 'Users', iconKey: 'users' },
      { href: '/platform/email', label: 'Platform email', iconKey: 'mail' },
      { href: '/platform/sms', label: 'SMS provider', iconKey: 'message' },
      { href: '/platform/ai', label: 'AI provider', iconKey: 'sparkles' },
      { href: '/platform/email-log', label: 'Email log', iconKey: 'scroll' },
      { href: '/platform/sms-log', label: 'SMS log', iconKey: 'scroll' },
      { href: '/platform/database', label: 'Database maintenance', iconKey: 'database' },
    ],
  },
]

/** True when the current route is part of the platform (super-admin) area. */
function useIsPlatform(): boolean {
  return (usePathname() ?? '').startsWith('/platform')
}

/** The nav groups to render: platform nav under /platform, else the tenant nav. */
export function useNavGroups(tenantGroups: SidebarNavGroup[]): SidebarNavGroup[] {
  return useIsPlatform() ? PLATFORM_NAV_GROUPS : tenantGroups
}
