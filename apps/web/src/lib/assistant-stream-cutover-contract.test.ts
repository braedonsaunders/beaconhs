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
})
