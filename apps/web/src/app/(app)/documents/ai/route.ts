// Streaming doc-assistant endpoint. The editor POSTs { messages, docText } and
// reads back a plain text stream. Auth-gated to the active tenant; 503 when AI
// is disabled so the UI can prompt to configure it.

import { streamDocChat, AIDisabledError, type DocChatMessage } from '@beaconhs/ai'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireRequestContext().catch(() => null)
  if (!ctx) return new Response('Unauthorized', { status: 401 })
  // The doc assistant lives on the manage-only editor surface — don't let
  // arbitrary tenant members stream tenant-billed completions through it.
  if (!can(ctx, 'documents.manage')) return new Response('Forbidden', { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const b = (body ?? {}) as Record<string, unknown>
  const raw = Array.isArray(b.messages) ? (b.messages as unknown[]) : []
  const messages: DocChatMessage[] = raw
    .map((m) => m as Record<string, unknown>)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: String(m.content).slice(0, 12000),
    }))
  const docText = typeof b.docText === 'string' ? b.docText : undefined

  if (messages.length === 0) return new Response('No messages', { status: 400 })

  const aiConfig = await getTenantAiConfig(ctx)
  try {
    return streamDocChat(aiConfig, { messages, docText })
  } catch (err) {
    if (err instanceof AIDisabledError) return new Response('AI is not configured', { status: 503 })
    return new Response('AI request failed', { status: 500 })
  }
}
