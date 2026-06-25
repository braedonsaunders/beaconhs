'use client'

// Platform (super-admin) sidebar navigation. When the user is anywhere under
// /platform, the main left sidebar is REPLACED by these items (instead of the
// tenant module nav). A small static set — the platform area is fixed, not
// tenant-customisable. Consumed by AppSidebar, MobileNavToggle and MobileTabBar.

import { usePathname } from 'next/navigation'
import type { SidebarNavGroup } from './sidebar-nav'

export const PLATFORM_NAV_GROUPS: SidebarNavGroup[] = [
  {
    label: 'Platform',
    items: [
      { href: '/platform', label: 'Overview', iconKey: 'grid', exact: true },
      { href: '/platform/tenants', label: 'Tenants', iconKey: 'building' },
      { href: '/platform/email', label: 'Email provider', iconKey: 'mail' },
      { href: '/platform/email-log', label: 'Email log', iconKey: 'scroll' },
    ],
  },
]

/** True when the current route is part of the platform (super-admin) area. */
export function useIsPlatform(): boolean {
  return (usePathname() ?? '').startsWith('/platform')
}

/** The nav groups to render: platform nav under /platform, else the tenant nav. */
export function useNavGroups(tenantGroups: SidebarNavGroup[]): SidebarNavGroup[] {
  return useIsPlatform() ? PLATFORM_NAV_GROUPS : tenantGroups
}
