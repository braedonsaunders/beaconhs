import Link from 'next/link'
import { Bell, Check, Settings } from 'lucide-react'
import { Badge, Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { InboxList } from './_inbox-list'
import { fetchInboxPage, inboxUnreadCount, markAllNotificationsRead } from './actions'

export const metadata = { title: 'Inbox' }
export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const [{ items, hasMore }, unread] = await Promise.all([fetchInboxPage(), inboxUnreadCount()])

  return (
    <PageContainer>
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <PageHeader
          title="Inbox"
          description="Notifications across every delivery channel."
          actions={
            <div className="flex items-center gap-2">
              {unread > 0 ? (
                <>
                  <Badge variant="secondary">{unread} unread</Badge>
                  <form action={markAllNotificationsRead}>
                    <Button variant="outline" size="sm">
                      <Check size={14} /> Mark all read
                    </Button>
                  </form>
                </>
              ) : null}
              <Link href="/notifications/preferences" aria-label="Notification settings">
                <Button variant="outline" size="sm">
                  <Settings size={14} /> Settings
                </Button>
              </Link>
            </div>
          }
        />

        {items.length === 0 ? (
          <EmptyState
            icon={<Bell size={32} />}
            title="No notifications"
            description="New notifications appear here."
          />
        ) : (
          <InboxList initialItems={items} initialHasMore={hasMore} />
        )}
      </div>
    </PageContainer>
  )
}
