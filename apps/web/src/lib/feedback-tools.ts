import type { FeedbackToolPart } from '@braedonsaunders/appkit-feedback'

export function feedbackToolPartsFromResult(result: {
  steps?: readonly {
    toolResults?: readonly { toolName?: string; output?: unknown }[]
    content?: readonly { type?: string; toolName?: string; output?: unknown }[]
  }[]
}): FeedbackToolPart[] {
  const parts: FeedbackToolPart[] = []
  for (const step of result.steps ?? []) {
    if (Array.isArray(step.toolResults)) {
      for (const item of step.toolResults) {
        if (typeof item?.toolName === 'string' && item.toolName.trim()) {
          parts.push({
            toolName: item.toolName,
            state: 'output-available',
            output: item.output,
          })
        }
      }
    }
    if (Array.isArray(step.content)) {
      for (const item of step.content) {
        if (!item || typeof item !== 'object') continue
        const type = typeof item.type === 'string' ? item.type : ''
        if (type !== 'tool-result' && !type.startsWith('tool-')) continue
        parts.push({
          type,
          toolName: item.toolName,
          state: 'output-available',
          output: item.output,
        })
      }
    }
  }
  return parts
}
