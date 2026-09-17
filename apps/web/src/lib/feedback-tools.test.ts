import { describe, expect, it } from 'vitest'
import { interpretFeedbackTurn } from '@braedonsaunders/appkit-feedback'
import { feedbackToolPartsFromResult } from './feedback-tools'

describe('feedbackToolPartsFromResult', () => {
  it('reads the last terminal tool from generateText steps', () => {
    const parts = feedbackToolPartsFromResult({
      steps: [
        {
          toolResults: [{ toolName: 'search_help', output: { items: [] } }],
        },
        {
          content: [
            {
              type: 'tool-result',
              toolName: 'resolve_as_guidance',
              output: {
                title: 'Try the user guide',
                explanation: 'Search Help for this task.',
                help: [],
              },
            },
          ],
        },
      ],
    })
    expect(interpretFeedbackTurn(parts)).toEqual({
      kind: 'guidance',
      title: 'Try the user guide',
      explanation: 'Search Help for this task.',
      help: [],
    })
  })
})
