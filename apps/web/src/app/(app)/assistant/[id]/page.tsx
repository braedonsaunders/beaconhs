import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiSettings } from '@/lib/ai-config'
import {
  getConversationMessages,
  listConversations,
  listSharedConversations,
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
  const ctx = await requireRequestContext()
  if (!can(ctx, 'assistant.use')) redirect('/dashboard')

  const access = await resolveConversationAccess(id)
  if (access === 'none') redirect('/assistant')

  const [own, shared, msgs, ai, cookieStore] = await Promise.all([
    listConversations('assistant'),
    listSharedConversations('assistant'),
    getConversationMessages(id),
    getTenantAiSettings(ctx),
    cookies(),
  ])

  const initialMessages = msgs.map((m) => ({
    id: m.id,
    role: m.role,
    parts:
      m.data && Array.isArray((m.data as { parts?: unknown }).parts)
        ? ((m.data as { parts: unknown[] }).parts as unknown[])
        : [{ type: 'text', text: m.content }],
  }))

  return (
    <AssistantApp
      key={id}
      ownConversations={own}
      sharedConversations={shared}
      activeId={id}
      initialMessages={initialMessages}
      access={access}
      canWrite={can(ctx, 'assistant.write')}
      aiEnabled={ai.enabled && ai.hasKey}
      defaultSidebarCollapsed={cookieStore.get('assistant_sidebar_collapsed')?.value === '1'}
    />
  )
}
