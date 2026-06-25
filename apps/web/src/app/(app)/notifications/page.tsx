import { fetchInboxFolders, fetchInboxPage } from './actions'
import { OutlookInbox } from './_outlook-inbox'

export const metadata = { title: 'Inbox' }
export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const [{ items, hasMore }, folders] = await Promise.all([fetchInboxPage(), fetchInboxFolders()])

  return <OutlookInbox initialItems={items} initialHasMore={hasMore} initialFolders={folders} />
}
