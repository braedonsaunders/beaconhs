import { getGeneratedTranslations } from '@/i18n/generated.server'
import { fetchInboxFolders, fetchInboxPage } from './actions'
import { OutlookInbox } from './_outlook-inbox'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_13b9d8a678398c') }
}
export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const [{ items, hasMore }, folders] = await Promise.all([fetchInboxPage(), fetchInboxFolders()])

  return <OutlookInbox initialItems={items} initialHasMore={hasMore} initialFolders={folders} />
}
