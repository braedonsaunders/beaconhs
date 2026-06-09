// Document AI chat — a doc-aware assistant for writing/editing controlled
// documents (policies, procedures, SDS, manuals, forms…). Streams plain text;
// when drafting document content it emits clean HTML the editor can insert.

import { streamText } from 'ai'
import { AIDisabledError, getModel, type AiConfig } from './client'

export type DocChatMessage = { role: 'user' | 'assistant'; content: string }

const DOC_SYSTEM = `You are an expert health, safety & compliance documentation assistant embedded inside a document editor. You help users write and edit controlled documents — policies, procedures (SOPs), safety data sheets, manuals, forms, and training material.

How to respond:
- When the user asks you to DRAFT, WRITE, REWRITE, or EDIT a document or a section, output the document content itself as clean semantic HTML using only these tags: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <table>, <thead>, <tbody>, <tr>, <th>, <td>. Do NOT wrap it in markdown code fences and do NOT add commentary before or after — output only the HTML so it can be inserted directly.
- When the user asks a QUESTION or for advice/feedback, answer conversationally in plain prose (no HTML).
- Write in clear, professional, compliance-appropriate language suitable for a regulated workplace.
- Never fabricate specific regulatory citations, standard numbers, dates, or figures that weren't provided. Where a specific must be supplied, insert a clear [PLACEHOLDER] for the user to complete.
- Be practical and concise.`

/**
 * Stream a doc-assistant reply as a plain text-stream Response. Throws
 * AIDisabledError when the tenant has no model configured.
 */
export function streamDocChat(
  config: AiConfig | null | undefined,
  args: { messages: DocChatMessage[]; docText?: string },
): Response {
  const model = getModel(config, 'smart')
  if (!model) throw new AIDisabledError()

  const docContext = args.docText?.trim()
    ? `\n\nFor context, the document currently contains:\n"""\n${args.docText.slice(0, 8000)}\n"""`
    : '\n\nThe document is currently empty.'

  const result = streamText({
    model,
    system: DOC_SYSTEM + docContext,
    messages: args.messages
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content })),
    temperature: 0.5,
  })
  return result.toTextStreamResponse()
}
