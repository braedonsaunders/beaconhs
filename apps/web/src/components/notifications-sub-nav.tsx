// Shared sub-nav that ties the scattered notification surfaces into ONE area:
// the routing rules, reusable groups, the email/SMS transports, the template
// library, and the delivery logs. Rendered under each page's header so the
// whole notification system reads as a single place. Dumb component.

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'

export type NotificationsTab =
  | 'rules'
  | 'groups'
  | 'email'
  | 'sms'
  | 'templates'
  | 'email-log'
  | 'sms-log'

const TABS = [
  { key: 'rules', label: 'Rules', href: '/admin/notifications' },
  { key: 'groups', label: 'Groups', href: '/admin/notifications/groups' },
  { key: 'email', label: 'Email', href: '/admin/email' },
  { key: 'sms', label: 'SMS', href: '/admin/sms' },
  { key: 'templates', label: 'Templates', href: '/admin/email-templates' },
  { key: 'email-log', label: 'Email log', href: '/admin/email-log' },
  { key: 'sms-log', label: 'SMS log', href: '/admin/sms-log' },
]

export function NotificationsSubNav({
  active,
  showBack = true,
}: {
  active: NotificationsTab
  /** Render the "← Admin" pill. Pass false on pages that already have a header back link. */
  showBack?: boolean
}) {
  return (
    <ModuleSubNav
      tabs={TABS}
      active={active}
      back={showBack ? { href: '/admin', label: 'Admin' } : undefined}
    />
  )
}
