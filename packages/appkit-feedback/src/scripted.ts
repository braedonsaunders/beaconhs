import { prepareIssueDraft } from './issue'
import type {
  FeedbackClient,
  FeedbackClientInput,
  FeedbackContext,
  IssuePublisher,
  KnowledgeHit,
  KnowledgeSource,
} from './types'

export type ScriptedFeedbackOptions = {
  knowledge?: KnowledgeSource
  publisher: IssuePublisher
  defaultLabels?: readonly string[]
  unavailableMessage?: string
}

export function createScriptedFeedbackClient(options: ScriptedFeedbackOptions): FeedbackClient {
  return {
    async send(input) {
      try {
        return await runScriptedTurn(options, input)
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : (options.unavailableMessage ??
              'The report could not be completed. Try again in a moment.')
        return { kind: 'unavailable', message }
      }
    },
  }
}

async function runScriptedTurn(options: ScriptedFeedbackOptions, input: FeedbackClientInput) {
  const text = input.text.trim()
  if (!text) {
    return {
      kind: 'questions' as const,
      questions: [{ id: 'what', prompt: 'What went wrong?', choices: undefined }],
    }
  }

  if (!input.forceFile && wordCount(text) < 6 && Object.keys(input.answers ?? {}).length === 0) {
    return {
      kind: 'questions' as const,
      questions: [
        {
          id: 'kind',
          prompt: 'Is this a product defect, or do you need help using the app?',
          choices: ['Product defect', 'I need help using the app'],
        },
        {
          id: 'detail',
          prompt: 'What did you expect to happen?',
        },
      ],
    }
  }

  const help =
    options.knowledge && !input.forceFile && looksLikeHelp(text, input.answers)
      ? await options.knowledge.search(text)
      : []
  if (help.length > 0 && !input.forceFile) {
    const first = help[0]!
    return {
      kind: 'guidance' as const,
      title: first.title,
      explanation:
        first.excerpt?.trim() ||
        'This looks like a how-to question. The help article below should cover it.',
      help: help.slice(0, 3),
    }
  }

  if (options.publisher.searchOpen && !input.forceFile) {
    const existing = await options.publisher.searchOpen(text)
    if (existing[0]) {
      const match = existing[0]
      return {
        kind: 'guidance' as const,
        title: 'This is already being tracked',
        explanation:
          'An open product issue already describes this. You can follow that report instead of filing another.',
        help: [{ id: match.id, title: match.title, url: match.url }] satisfies KnowledgeHit[],
      }
    }
  }

  const prepared = prepareIssueDraft({
    title: inferTitle(text),
    whatHappened: text,
    expected: input.answers?.detail,
    surface: inferSurface(input.context),
    labels: [...(options.defaultLabels ?? [])],
    context: input.context,
  })
  const issue = await options.publisher.create(prepared.draft)
  return {
    kind: 'filed' as const,
    issue: { ...issue, title: issue.title || prepared.draft.title },
    stripped: prepared.stripped,
  }
}

function looksLikeHelp(text: string, answers?: Record<string, string>): boolean {
  if (answers?.kind === 'I need help using the app') return true
  return /\b(how do i|how to|where is|where do i|can i|help)\b/i.test(text)
}

function inferTitle(text: string): string {
  const first = text.split(/\n/)[0]?.replace(/\s+/g, ' ').trim() ?? 'Product issue'
  return first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first
}

function inferSurface(context: FeedbackContext): string | undefined {
  const segment = context.pathname.split('/').filter(Boolean)[0]
  if (!segment) return context.pageTitle
  return segment.replace(/[-_]/g, ' ')
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
