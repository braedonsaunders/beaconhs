export type FeedbackContext = {
  pathname: string
  pageTitle?: string
  appVersion?: string
  locale?: string
}

export type SanitizedFeedbackContext = {
  pathname: string
  pageTitle?: string
  appVersion?: string
  locale?: string
}

export type KnowledgeHit = {
  id: string
  title: string
  url: string
  excerpt?: string
}

export type KnowledgeSource = {
  search: (query: string) => Promise<KnowledgeHit[]>
  read: (id: string) => Promise<{ title: string; url: string; body: string } | null>
}

export type IssueSeverity = 'low' | 'medium' | 'high'

export type IssueDraft = {
  title: string
  body: string
  labels: string[]
  severity?: IssueSeverity
}

export type PublishedIssue = {
  id: string
  number: number
  url: string
  title: string
}

export type IssuePublisher = {
  searchOpen?: (query: string) => Promise<Array<{ id: string; title: string; url: string }>>
  create: (draft: IssueDraft) => Promise<PublishedIssue>
}

export type FeedbackQuestion = {
  id: string
  prompt: string
  choices?: string[]
}

export type FeedbackTurnResult =
  | { kind: 'guidance'; title: string; explanation: string; help: KnowledgeHit[] }
  | { kind: 'questions'; questions: FeedbackQuestion[] }
  | { kind: 'filed'; issue: PublishedIssue; stripped: string[] }
  | { kind: 'unavailable'; message: string }

export type FeedbackClientInput = {
  text: string
  context: FeedbackContext
  answers?: Record<string, string>
  forceFile?: boolean
  sessionId?: string | null
}

export type FeedbackClient = {
  send: (input: FeedbackClientInput) => Promise<FeedbackTurnResult>
}

export type FeedbackHttpRequest = (input: {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}) => Promise<{ status: number; body: string }>

export type FeedbackRedactOptions = {
  denyList?: readonly string[]
}

export type PreparedIssueDraft = {
  draft: IssueDraft
  stripped: string[]
  context: SanitizedFeedbackContext
}

export type FeedbackToolPart = {
  type?: string
  toolName?: string
  state?: string
  output?: unknown
}

export const FEEDBACK_TERMINAL_TOOLS = [
  'resolve_as_guidance',
  'ask_questions',
  'submit_issue',
] as const
export type FeedbackTerminalTool = (typeof FEEDBACK_TERMINAL_TOOLS)[number]
