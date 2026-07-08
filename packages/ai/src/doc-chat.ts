// Document AI agent — a doc-aware assistant embedded in the Writer editor
// that can answer questions, WRITE a whole document, and make surgical
// exact-match edits (find→replace, Claude-Code-style) through tools the host
// executes against the DOCX master. One call runs a full tool loop and
// returns the final assistant text plus what changed.

import { generateText, stepCountIs, tool, type ModelMessage } from 'ai'
import { z } from 'zod'
import { AIDisabledError, getModel, type AiConfig } from './client'

export type DocChatMessage = { role: 'user' | 'assistant'; content: string }

export type DocAgentToolImpl = {
  /** Fresh plain text of the current document. */
  readDocument: () => Promise<string>
  /** Exact-match text edits; returns per-edit occurrence counts. */
  editDocument: (
    edits: { find: string; replace: string }[],
  ) => Promise<{ find: string; count: number }[]>
  /** Replace the entire document with new HTML content. */
  writeDocument: (html: string) => Promise<void>
}

export type DocAgentResult = {
  text: string
  /** Human-readable notes about what the agent did (shown in the panel). */
  actions: string[]
  docChanged: boolean
}

const DOC_AGENT_SYSTEM = `You are an expert health, safety & compliance documentation assistant embedded inside a Word document editor. You help write and edit controlled documents — policies, procedures (SOPs), safety data sheets, manuals, forms, and training material.

You can EDIT THE OPEN DOCUMENT DIRECTLY with your tools:
- read_document — returns the document's current plain text. Read before editing when you are not certain of the exact current wording.
- edit_document — precise find→replace edits. Each "find" must be an EXACT substring of the current document text (copy it verbatim from read_document output, including punctuation and spacing) and should be long enough to be unique. Keep each "find" within a single paragraph. Every occurrence is replaced; the result reports the occurrence count per edit — 0 means your "find" did not match and you must re-read and retry with corrected text.
- write_document — replaces the ENTIRE document. Use for drafting a document from scratch or a full rewrite. Provide clean semantic HTML using only: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <blockquote> <table> <thead> <tbody> <tr> <th> <td>. No markdown, no code fences.

Working style:
- When asked to draft/write a document: call write_document with the complete content, then reply with a one-sentence confirmation of what you created.
- When asked to change/fix/update specific content: use edit_document with tight, exact find strings. On a 0-count result, re-read the document and retry once with corrected text.
- When asked a question or for review/feedback: just answer in plain prose — do not modify the document.
- Write in clear, professional, compliance-appropriate language. Never fabricate regulatory citations, standard numbers, dates, or figures; use [PLACEHOLDER] where a specific must be supplied (named individuals or role-holders, site addresses, effective/revision dates, specific figures).
- Your final reply is a short plain-prose summary or answer — never dump document content into the reply when a tool already applied it.`

/**
 * Run one agent turn (multi-step tool loop) for the document assistant.
 * Throws AIDisabledError when the tenant has no model configured.
 */
export async function runDocAgent(
  config: AiConfig | null | undefined,
  args: {
    messages: DocChatMessage[]
    docText?: string
    tools: DocAgentToolImpl
    maxSteps?: number
  },
): Promise<DocAgentResult> {
  const model = getModel(config, 'smart')
  if (!model) throw new AIDisabledError()

  // Org identity rides on the config (see getTenantAiConfig).
  const orgName = config?.org?.name?.trim()
  const orgContext = orgName
    ? `\n\nThis document is authored for the organization "${orgName}". Use this exact name wherever the document refers to the organization (e.g. "${orgName} is committed to…") — do NOT use a placeholder for the company name.`
    : ''
  const docContext = args.docText?.trim()
    ? `\n\nThe document currently contains:\n"""\n${args.docText.slice(0, 16_000)}\n"""`
    : '\n\nThe document is currently empty.'

  const actions: string[] = []
  let docChanged = false

  const tools = {
    read_document: tool({
      description: "Read the document's current plain text.",
      inputSchema: z.object({}),
      execute: async () => {
        actions.push('Read the document')
        const text = await args.tools.readDocument()
        return text ? text.slice(0, 24_000) : '(the document is empty)'
      },
    }),
    edit_document: tool({
      description:
        'Apply precise find→replace edits to the document. Each find must be an exact, unique substring of the current text.',
      inputSchema: z.object({
        edits: z
          .array(
            z.object({
              find: z.string().min(1).max(4000),
              replace: z.string().max(8000),
            }),
          )
          .min(1)
          .max(20),
      }),
      execute: async ({ edits }) => {
        const results = await args.tools.editDocument(edits)
        const changes = results.reduce((n, r) => n + r.count, 0)
        if (changes > 0) {
          docChanged = true
          actions.push(`Edited the document (${changes} change${changes === 1 ? '' : 's'})`)
        }
        const misses = results.filter((r) => r.count === 0)
        if (misses.length > 0) actions.push(`${misses.length} edit(s) did not match`)
        return results
          .map((r) =>
            r.count > 0
              ? `Replaced ${r.count} occurrence(s) of: ${r.find.slice(0, 80)}`
              : `NOT FOUND (0 occurrences — re-read the document and retry with exact text): ${r.find.slice(0, 120)}`,
          )
          .join('\n')
      },
    }),
    write_document: tool({
      description:
        'Replace the entire document with new HTML content (drafting from scratch or a full rewrite).',
      inputSchema: z.object({ html: z.string().min(20).max(400_000) }),
      execute: async ({ html }) => {
        await args.tools.writeDocument(html)
        docChanged = true
        actions.push('Wrote the document')
        return 'The document now contains the provided content.'
      },
    }),
  }

  const messages: ModelMessage[] = args.messages
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }))

  const result = await generateText({
    model,
    system: DOC_AGENT_SYSTEM + orgContext + docContext,
    messages,
    tools,
    stopWhen: stepCountIs(args.maxSteps ?? 8),
    temperature: 0.4,
  })

  return {
    text: result.text.trim() || (docChanged ? 'Done.' : ''),
    actions,
    docChanged,
  }
}
