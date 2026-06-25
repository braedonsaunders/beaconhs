import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiSettings } from '@/lib/ai-config'
import { listConversations, listSharedConversations } from '@/lib/ai-conversations'
import { AssistantApp } from './_components/assistant-app'

export const dynamic = 'force-dynamic'

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'assistant.use')) redirect('/dashboard')
  const { q } = await searchParams

  const [own, shared, ai, cookieStore] = await Promise.all([
    listConversations('assistant'),
    listSharedConversations('assistant'),
    getTenantAiSettings(ctx),
    cookies(),
  ])

  return (
    <AssistantApp
      key="new"
      ownConversations={own}
      sharedConversations={shared}
      activeId={null}
      initialMessages={[]}
      access="owner"
      canWrite={can(ctx, 'assistant.write')}
      aiEnabled={ai.enabled && ai.hasKey}
      initialPrompt={typeof q === 'string' ? q : undefined}
      defaultSidebarCollapsed={cookieStore.get('assistant_sidebar_collapsed')?.value === '1'}
    />
  )
}
