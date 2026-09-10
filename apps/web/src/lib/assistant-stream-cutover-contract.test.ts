import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(resolve(import.meta.dirname, relative), 'utf8')

describe('assistant stream cutover', () => {
  it('returns the SDK stream Response and does not reconstruct or mutate headers', () => {
    const route = read('../app/(app)/assistant/chat/route.ts')
    const agent = readFileSync(
      resolve(import.meta.dirname, '../../../../packages/ai/src/agent.ts'),
      'utf8',
    )
    const client = readFileSync(
      resolve(import.meta.dirname, '../../../../packages/ai/src/client.ts'),
      'utf8',
    )
    expect(route).toContain('headers: {')
    expect(route).toContain("'x-conversation-id': conversationId")
    expect(route).toContain('return res')
    expect(route).not.toContain('return new Response(res.body')
    expect(route).not.toContain('res.headers.set')
    expect(agent).toContain('headers: args.headers')
    expect(client).toContain('stripHopByHopOutboundHeaders')
    expect(client).toContain('stream: true')
  })

  it('never posts an explicit null conversationId for a new chat', () => {
    // JSON.stringify keeps null but drops undefined, so sending the key with a
    // null value is a real request the server has to interpret. The client omits
    // it instead; turn-request.test.ts pins the server half.
    const app = read('../app/(app)/assistant/_components/assistant-app.tsx')
    expect(app).toContain('conversationId ? { conversationId, prompt: text } : { prompt: text }')
    expect(app).not.toContain('JSON.stringify({ conversationId, prompt: text })')
  })
})
