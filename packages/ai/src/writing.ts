// Inline writing assist — streamed token-by-token into the editor.

import { streamText } from 'ai'
import { AIDisabledError, getModel, type AiConfig } from './client'
import { JOURNAL_SYSTEM, orgContextLine } from './prompts'

export type WritingMode =
  'tidy' | 'expand' | 'continue' | 'rephrase' | 'fix' | 'bulletize' | 'summarize'

export const WRITING_MODES: WritingMode[] = [
  'tidy',
  'expand',
  'continue',
  'rephrase',
  'fix',
  'bulletize',
  'summarize',
]

const INSTRUCTIONS: Record<WritingMode, string> = {
  tidy: 'Rewrite the journal text below so it reads clearly and professionally, preserving every fact. Fix grammar and flow. Keep it roughly the same length.',
  expand:
    'Expand the brief notes below into a fuller daily-journal entry. Add natural connective wording, but NEVER invent specific facts (names, numbers, events) that are not present or clearly implied.',
  continue:
    'Continue the journal entry below in the same first-person voice for one to three more sentences. Output only the continuation.',
  rephrase: 'Rephrase the journal text below{tone}, preserving the meaning and all facts.',
  fix: 'Correct spelling, grammar and punctuation in the text below. Change nothing else.',
  bulletize:
    'Convert the journal text below into a tight bulleted list covering work done, hazards, and follow-up actions. Use "- " bullets and no preamble.',
  summarize:
    'Summarize the journal text below into one short paragraph capturing the key work, hazards and actions.',
}

export function isWritingMode(v: string): v is WritingMode {
  return (WRITING_MODES as string[]).includes(v)
}

/**
 * Stream a writing-assist transformation as a plain text-stream Response. Throws
 * AIDisabledError when the tenant has no model configured.
 */
export function streamWritingAssist(
  config: AiConfig | null | undefined,
  args: { mode: WritingMode; text: string; tone?: string; context?: string },
): Response {
  const model = getModel(config, 'fast')
  if (!model) throw new AIDisabledError()

  const instruction = INSTRUCTIONS[args.mode].replace(
    '{tone}',
    args.tone ? ` in a ${args.tone} tone` : '',
  )
  const context = args.context
    ? `\n\nContext (background only, do not repeat verbatim): ${args.context}`
    : ''

  const result = streamText({
    model,
    system: JOURNAL_SYSTEM + orgContextLine(config?.org),
    prompt: `${instruction}${context}\n\n---\n${args.text}`,
    temperature: 0.4,
  })
  return result.toTextStreamResponse()
}
