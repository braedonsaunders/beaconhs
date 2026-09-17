import { generateText, stepCountIs } from 'ai'
import { getTranslations } from 'next-intl/server'
import {
  composeFeedbackUserMessage,
  createFeedbackTools,
  createGithubIssuePublisher,
  feedbackSystemPrompt,
  interpretFeedbackTurn,
  type FeedbackContext,
  type FeedbackTurnResult,
  type IssuePublisher,
} from '@braedonsaunders/appkit-feedback'
import { AIDisabledError, getModel } from '@beaconhs/ai'
import { can } from '@beaconhs/tenant'
import { getRequestContext, getSessionUser } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import {
  appendMessage,
  createConversation,
  resolveConversationAccess,
} from '@/lib/ai-conversations'
import { recordAudit } from '@/lib/audit'
import { feedbackFiledAuditEvent } from '@/lib/feedback-audit'
import { feedbackDenyList, getPlatformFeedbackRuntime } from '@/lib/feedback-config'
import { feedbackGithubRequest } from '@/lib/feedback-github'
import { createFeedbackKnowledge } from '@/lib/feedback-knowledge'
import { feedbackToolPartsFromResult } from '@/lib/feedback-tools'
import { MAX_FEEDBACK_REQUEST_BYTES, parseFeedbackTurnRequest } from '@/lib/feedback-turn-request'
import {
  readBoundedJsonBody,
  RequestBodyLengthError,
  RequestBodyParseError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SCOPE = 'feedback'
const REQUEST_TIMEOUT_MS = 15_000

function jsonResult(result: FeedbackTurnResult & { sessionId?: string }, status = 200): Response {
  return Response.json(result, { status })
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await getRequestContext()
  if (!ctx) return new Response('Unauthorized', { status: 401 })
  if (!can(ctx, 'feedback.use')) return new Response('Forbidden', { status: 403 })

  const t = await getTranslations('Feedback')
  const unavailable = (): FeedbackTurnResult => ({
    kind: 'unavailable',
    message: t('unavailableBody'),
  })

  let body: unknown
  try {
    body = await readBoundedJsonBody(req, {
      maxBytes: MAX_FEEDBACK_REQUEST_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response('Request too large', { status: 413 })
    }
    if (error instanceof RequestBodyTimeoutError) {
      return new Response('Request timed out', { status: 408 })
    }
    if (error instanceof RequestBodyLengthError || error instanceof RequestBodyParseError) {
      return new Response('Bad request', { status: 400 })
    }
    return new Response('Bad request', { status: 400 })
  }

  const parsed = parseFeedbackTurnRequest(body)
  if (!parsed.ok) return new Response(parsed.reason, { status: parsed.status })
  const request = parsed.request

  const [runtime, aiConfig, sessionUser] = await Promise.all([
    getPlatformFeedbackRuntime(),
    getTenantAiConfig(ctx),
    getSessionUser(),
  ])
  const model = getModel(aiConfig, 'fast')
  if (!runtime || !model) return jsonResult(unavailable(), 503)

  let sessionId = request.sessionId
  if (sessionId && (await resolveConversationAccess(sessionId, SCOPE)) !== 'owner') {
    return new Response('Forbidden', { status: 403 })
  }
  if (!sessionId) {
    sessionId = await createConversation({
      scope: SCOPE,
      title: request.text.slice(0, 80),
    })
  }

  const context: FeedbackContext = {
    pathname: request.includePage ? request.pathname : '/',
    pageTitle: request.includePage ? request.pageTitle : undefined,
    appVersion: process.env.DEPLOYMENT_VERSION || 'dev',
    locale: ctx.locale,
  }
  const denyList = await feedbackDenyList(ctx, sessionUser?.email)
  const github = createGithubIssuePublisher({
    owner: runtime.owner,
    repo: runtime.repo,
    token: runtime.token,
    labels: runtime.labels,
    request: feedbackGithubRequest,
  })
  const publisher: IssuePublisher = runtime.searchDuplicates
    ? github
    : { create: (draft) => github.create(draft) }

  try {
    await appendMessage({ conversationId: sessionId, role: 'user', content: request.text })
    const generated = await generateText({
      model,
      system: feedbackSystemPrompt({
        productName: 'BeaconHS',
        forceFile: request.forceFile,
      }),
      prompt: composeFeedbackUserMessage({
        text: request.text,
        pathname: context.pathname,
        pageTitle: context.pageTitle,
        appVersion: context.appVersion,
        answers: request.answers,
        includePage: request.includePage,
      }),
      tools: createFeedbackTools({
        knowledge: createFeedbackKnowledge(ctx),
        publisher,
        context,
        defaultLabels: runtime.labels,
        redact: { denyList },
      }),
      stopWhen: stepCountIs(8),
      abortSignal: req.signal,
      temperature: 0.2,
    })
    const result = interpretFeedbackTurn(feedbackToolPartsFromResult(generated))
    try {
      await appendMessage({
        conversationId: sessionId,
        role: 'assistant',
        content: result.kind === 'guidance' ? result.explanation : result.kind,
        data: { v: 1, kind: 'feedback-turn', result },
      })
      if (result.kind === 'filed') {
        await recordAudit(ctx, feedbackFiledAuditEvent(result, sessionId))
      }
    } catch (error) {
      console.error('[feedback/turn] failed to persist turn', error)
    }
    return jsonResult({ ...result, sessionId })
  } catch (error) {
    if (error instanceof AIDisabledError) return jsonResult(unavailable(), 503)
    console.error('[feedback/turn] failed', error)
    return jsonResult({ ...unavailable(), sessionId }, 500)
  }
}
