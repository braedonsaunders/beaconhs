import { asKnowledgeHits } from './tools'
import {
  FEEDBACK_TERMINAL_TOOLS,
  type FeedbackQuestion,
  type FeedbackToolPart,
  type FeedbackTurnResult,
  type PublishedIssue,
} from './types'

const UNAVAILABLE: FeedbackTurnResult = {
  kind: 'unavailable',
  message: 'The report could not be completed. Try again in a moment.',
}

export function interpretFeedbackTurn(parts: readonly FeedbackToolPart[]): FeedbackTurnResult {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (!part || !isCompletedTool(part)) continue
    const name = toolName(part)
    if (!isTerminalTool(name)) continue
    const result = readTerminalOutput(name, part.output)
    if (result) return result
  }
  return UNAVAILABLE
}

export function latestFeedbackToolName(parts: readonly FeedbackToolPart[]): string | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (!part) continue
    const name = toolName(part)
    if (name) return name
  }
  return undefined
}

function isCompletedTool(part: FeedbackToolPart): boolean {
  return !part.state || part.state === 'output-available' || part.state === 'result'
}

function toolName(part: FeedbackToolPart): string | undefined {
  if (typeof part.toolName === 'string' && part.toolName.trim()) return part.toolName.trim()
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const name = part.type.slice(5)
    return name || undefined
  }
  return undefined
}

function isTerminalTool(
  name: string | undefined,
): name is (typeof FEEDBACK_TERMINAL_TOOLS)[number] {
  return name !== undefined && (FEEDBACK_TERMINAL_TOOLS as readonly string[]).includes(name)
}

function readTerminalOutput(
  name: (typeof FEEDBACK_TERMINAL_TOOLS)[number],
  output: unknown,
): FeedbackTurnResult | null {
  const record = asRecord(output)
  if (!record) return null
  if (name === 'resolve_as_guidance') {
    const title = asString(record.title)
    const explanation = asString(record.explanation)
    if (!title || !explanation) return null
    return { kind: 'guidance', title, explanation, help: asKnowledgeHits(record.help) }
  }
  if (name === 'ask_questions') {
    const questions = asQuestions(record.questions)
    if (questions.length === 0) return null
    return { kind: 'questions', questions: questions.slice(0, 2) }
  }
  const issue = asPublishedIssue(record.issue ?? record)
  if (!issue) return null
  return {
    kind: 'filed',
    issue,
    stripped: Array.isArray(record.stripped)
      ? record.stripped.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function asQuestions(value: unknown): FeedbackQuestion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = asString(record?.id)
    const prompt = asString(record?.prompt)
    if (!id || !prompt) return []
    const choices = Array.isArray(record?.choices)
      ? record.choices.filter(
          (choice): choice is string => typeof choice === 'string' && choice.trim().length > 0,
        )
      : undefined
    return [{ id, prompt, choices: choices && choices.length > 0 ? choices : undefined }]
  })
}

function asPublishedIssue(value: unknown): PublishedIssue | null {
  const record = asRecord(value)
  if (!record) return null
  const id = asString(record.id)
  const url = asString(record.url)
  const title = asString(record.title) ?? 'Product issue'
  const number = typeof record.number === 'number' ? record.number : Number(record.number)
  if (!id || !url || !Number.isInteger(number)) return null
  return { id, number, url, title }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
