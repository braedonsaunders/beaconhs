import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { normalizeIssueSeverity, prepareIssueDraft } from './issue'
import { redactPii } from './redact'
import type {
  FeedbackContext,
  FeedbackRedactOptions,
  IssuePublisher,
  KnowledgeHit,
  KnowledgeSource,
} from './types'

export type FeedbackToolDeps = {
  knowledge?: KnowledgeSource
  publisher: IssuePublisher
  context: FeedbackContext
  defaultLabels?: readonly string[]
  redact?: FeedbackRedactOptions
}

const helpHitSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  excerpt: z.string().optional(),
})

export function createFeedbackTools(deps: FeedbackToolDeps): ToolSet {
  const tools: ToolSet = {
    resolve_as_guidance: tool({
      description:
        'End the turn with a help-first answer. Use when this is not a product defect or an existing issue already covers it.',
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        explanation: z.string().min(1).max(1200),
        help: z.array(helpHitSchema).max(5).default([]),
      }),
      execute: async (input) => ({
        kind: 'guidance' as const,
        title: input.title.trim(),
        explanation: input.explanation.trim(),
        help: input.help,
      }),
    }),
    ask_questions: tool({
      description:
        'Ask at most two clarifying questions when the report is too vague to file or answer. Prefer choices.',
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              prompt: z.string().min(1).max(200),
              choices: z.array(z.string().min(1).max(80)).max(6).optional(),
            }),
          )
          .min(1)
          .max(2),
      }),
      execute: async (input) => ({ kind: 'questions' as const, questions: input.questions }),
    }),
    submit_issue: tool({
      description:
        'File a generalized product issue. The host redacts personal data before publishing. Do not include names, emails, or record ids.',
      inputSchema: z.object({
        title: z.string().min(1).max(80),
        whatHappened: z.string().min(1).max(2000),
        expected: z.string().max(800).optional(),
        notes: z.string().max(800).optional(),
        surface: z.string().max(80).optional(),
        labels: z.array(z.string().min(1).max(40)).max(8).optional(),
        severity: z.enum(['low', 'medium', 'high']).optional(),
      }),
      execute: async (input) => {
        const prepared = prepareIssueDraft(
          {
            title: input.title,
            whatHappened: input.whatHappened,
            expected: input.expected,
            notes: input.notes,
            surface: input.surface,
            labels: [...(deps.defaultLabels ?? []), ...(input.labels ?? [])],
            severity: normalizeIssueSeverity(input.severity),
            context: deps.context,
          },
          deps.redact,
        )
        try {
          const issue = await deps.publisher.create(prepared.draft)
          return {
            kind: 'filed' as const,
            issue: { ...issue, title: issue.title || prepared.draft.title },
            stripped: prepared.stripped,
          }
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim()
              ? error.message
              : 'GitHub could not create the issue.'
          return { kind: 'unavailable' as const, message }
        }
      },
    }),
  }

  if (deps.knowledge) {
    const knowledge = deps.knowledge
    tools.search_help = tool({
      description: 'Search the host help source for how-to answers. Use this before filing.',
      inputSchema: z.object({ query: z.string().min(1).max(160) }),
      execute: async ({ query }) => {
        const items = await knowledge.search(query)
        return { items: items.slice(0, 8) }
      },
    })
    tools.read_help = tool({
      description: 'Read one help article by id returned from search_help.',
      inputSchema: z.object({ id: z.string().min(1).max(120) }),
      execute: async ({ id }) => {
        const article = await knowledge.read(id)
        return article ?? { missing: true }
      },
    })
  }

  if (deps.publisher.searchOpen) {
    const searchOpen = deps.publisher.searchOpen
    tools.search_existing_issues = tool({
      description: 'Search open product issues for a duplicate before filing a new one.',
      inputSchema: z.object({ query: z.string().min(1).max(160) }),
      execute: async ({ query }) => {
        const cleaned = redactPii(query, deps.redact).text
        const items = await searchOpen(cleaned)
        return { items: items.slice(0, 5) }
      },
    })
  }

  return tools
}

export function asKnowledgeHits(value: unknown): KnowledgeHit[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.title !== 'string' ||
      typeof record.url !== 'string'
    ) {
      return []
    }
    return [
      {
        id: record.id,
        title: record.title,
        url: record.url,
        excerpt: typeof record.excerpt === 'string' ? record.excerpt : undefined,
      },
    ]
  })
}
