import { beforeEach, describe, expect, it, vi } from 'vitest'

const runBuilderPrompt = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@beaconhs/ai', () => ({ runBuilderPrompt }))

import { generateAppFromPrompt, generateFlowFromPrompt } from './ai-generate'

const VALID_APP = {
  schemaVersion: 1,
  title: { en: 'Site inspection' },
  sections: [
    {
      id: 'general',
      fields: [{ id: 'notes', type: 'text', label: { en: 'Notes' } }],
    },
  ],
  workflow: {
    steps: [
      {
        key: 'submit',
        title: { en: 'Submit' },
        assignee: { type: 'expression', expr: '$submitter' },
      },
    ],
  },
}

describe('AI builder generation', () => {
  beforeEach(() => runBuilderPrompt.mockReset())

  it('extracts and validates a fenced app response', async () => {
    runBuilderPrompt.mockResolvedValue(`Draft:\n\`\`\`json\n${JSON.stringify(VALID_APP)}\n\`\`\``)

    const result = await generateAppFromPrompt(null, 'an inspection')

    expect(result).toMatchObject({ ok: true, value: VALID_APP })
    expect(runBuilderPrompt).toHaveBeenCalledTimes(1)
  })

  it('uses the same bounded retry contract for invalid JSON and schema errors', async () => {
    runBuilderPrompt
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(JSON.stringify(VALID_APP))

    const recovered = await generateAppFromPrompt(null, 'an inspection')
    expect(recovered.ok).toBe(true)
    expect(runBuilderPrompt.mock.calls[1]?.[1]?.prompt).toContain(
      'previous JSON was invalid (response was not valid JSON)',
    )

    runBuilderPrompt.mockReset()
    runBuilderPrompt.mockResolvedValue(JSON.stringify({ schemaVersion: 1 }))
    const failed = await generateAppFromPrompt(null, 'an inspection')
    expect(failed).toMatchObject({ ok: false })
    if (failed.ok) throw new Error('Expected invalid schema generation to fail')
    expect(failed.error).toContain('invalid app schema')
    expect(runBuilderPrompt).toHaveBeenCalledTimes(2)
  })

  it('applies the shared validator to flows and surfaces provider non-response', async () => {
    runBuilderPrompt.mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 1,
        nodes: [
          {
            id: 'trigger',
            position: { x: 0, y: 0 },
            data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
          },
        ],
        edges: [],
      }),
    )
    const flow = await generateFlowFromPrompt(null, 'notify me', [])
    expect(flow).toMatchObject({ ok: true, warnings: [] })

    runBuilderPrompt.mockResolvedValueOnce(null)
    const unavailable = await generateAppFromPrompt(null, 'an inspection')
    expect(unavailable).toEqual({
      ok: false,
      error: 'AI is not configured for this workspace, or the model did not respond.',
    })
  })
})
