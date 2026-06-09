// Streaming writing-assist endpoint. The editor POSTs { mode, text, tone? } and
// reads back a plain text stream, appending tokens live. Auth-gated to the
// active tenant; returns 503 when AI is disabled so the UI can fall back.

import { isWritingMode, streamWritingAssist, AIDisabledError } from '@beaconhs/ai'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireRequestContext().catch(() => null)
  if (!ctx) return new Response('Unauthorized', { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const b = (body ?? {}) as Record<string, unknown>
  const mode = String(b.mode ?? '')
  const text = String(b.text ?? '')
  const tone = b.tone ? String(b.tone) : undefined
  const context = b.context ? String(b.context).slice(0, 2000) : undefined

  if (!isWritingMode(mode)) return new Response('Invalid mode', { status: 400 })
  if (!text.trim()) return new Response('Nothing to work with', { status: 400 })

  const aiConfig = await getTenantAiConfig(ctx)
  try {
    return streamWritingAssist(aiConfig, { mode, text: text.slice(0, 8000), tone, context })
  } catch (err) {
    if (err instanceof AIDisabledError) return new Response('AI is not configured', { status: 503 })
    return new Response('AI request failed', { status: 500 })
  }
}
