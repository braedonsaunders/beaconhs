import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiSettings } from '@/lib/ai-config'
import { isUuid } from '@/lib/list-params'
import {
  getConversationMessagePage,
  getConversationSummary,
  listConversationPage,
  listSharedConversationPage,
  resolveConversationAccess,
} from '@/lib/ai-conversations'
import { AssistantApp } from '../_components/assistant-app'

export const dynamic = 'force-dynamic'

export default async function AssistantConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!can(ctx, 'assistant.use')) redirect('/dashboard')

  const access = await resolveConversationAccess(id, 'assistant')
  if (access === 'none') redirect('/assistant')

  const [ownPage, sharedPage, messagePage, activeSummary, ai, cookieStore] = await Promise.all([
    listConversationPage({ scope: 'assistant' }),
    listSharedConversationPage({ scope: 'assistant' }),
    getConversationMessagePage({ conversationId: id }),
    getConversationSummary(id, 'assistant'),
    getTenantAiSettings(ctx),
    cookies(),
  ])

  const initialMessages = messagePage.items.map((m) => ({
    id: m.id,
    role: m.role,
    parts:
      m.data && Array.isArray((m.data as { parts?: unknown }).parts)
        ? ((m.data as { parts: unknown[] }).parts as unknown[])
        : [{ type: 'text', text: m.content }],
  }))
  const own =
    activeSummary && !activeSummary.shared && !ownPage.items.some((item) => item.id === id)
      ? { ...ownPage, items: [activeSummary, ...ownPage.items] }
      : ownPage
  const shared =
    activeSummary?.shared && !sharedPage.items.some((item) => item.id === id)
      ? { ...sharedPage, items: [activeSummary, ...sharedPage.items] }
      : sharedPage

  return (
    <AssistantApp
      key={id}
      ownConversations={own}
      sharedConversations={shared}
      activeId={id}
      initialMessages={initialMessages}
      initialOlderCursor={messagePage.olderCursor}
      access={access}
      canWrite={can(ctx, 'assistant.write')}
      aiEnabled={ai.enabled && ai.hasKey}
      defaultSidebarCollapsed={cookieStore.get('assistant_sidebar_collapsed')?.value === '1'}
    />
  )
}
