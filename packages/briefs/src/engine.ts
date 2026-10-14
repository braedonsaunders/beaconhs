// The brief engine: evidence → writer → grounded result. Used by the worker
// (scheduled runs), the studio preview, and the public API, so every path
// produces the same result, evidence, and model metadata.

import { generateText } from 'ai'
import { extractJsonObject, getModel, resolveModelId, type AiConfig } from '@beaconhs/ai'
import type { BriefAiMeta, BriefEvidence, BriefResult, BriefSpec } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { collectEvidence, type CollectedEvidence } from './sources'
import {
  chunkRecords,
  promptHash,
  systemPrompt,
  userPrompt,
  writerOutputSchema,
  type WriterOutput,
} from './prompt'
import type { ResolvedBriefWindow } from './window'

/** Writer text per model call before the engine splits into map-reduce passes. */
export const SINGLE_PASS_CHAR_BUDGET = 60_000

export type ModelCall = (args: {
  system: string
  prompt: string
}) => Promise<{ text: string; inputTokens: number; outputTokens: number }>

export type BriefAiAvailability = {
  config: AiConfig | null
  reason: 'disabled' | 'unconfigured' | 'budget_reached' | null
}

export type GenerateBriefInput = {
  ctx: RequestContext
  briefName: string
  spec: BriefSpec
  specVersion: number
  window: ResolvedBriefWindow
  scope: { departmentId: string | null; departmentName: string | null }
  ai: BriefAiAvailability
  previous: { windowLabel: string; result: BriefResult } | null
  /** Test seams; default to the tenant model and the live sources. */
  callModel?: ModelCall
  collect?: typeof collectEvidence
  charBudget?: number
}

export type GeneratedBrief = {
  result: BriefResult
  evidence: BriefEvidence
  aiMeta: BriefAiMeta
  /** True when the window had no records and the spec says to skip delivery. */
  skipped: boolean
  /** Sources the run-as member cannot read (named on the run). */
  unavailable: string[]
}

export class BriefGenerationError extends Error {
  override readonly name = 'BriefGenerationError'
}

function modelCaller(config: AiConfig, tier: BriefSpec['tier']): ModelCall {
  const model = getModel(config, tier, 'briefs')
  if (!model) throw new BriefGenerationError('The AI model is not configured.')
  return async ({ system, prompt }) => {
    const result = await generateText({ model, system, prompt, temperature: 0.2 })
    return {
      text: result.text,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    }
  }
}

function modelId(config: AiConfig | null, tier: BriefSpec['tier']): string | null {
  return config ? resolveModelId(config, tier) : null
}

type CallStats = { inputTokens: number; outputTokens: number; passes: number }

async function write(
  call: ModelCall,
  system: string,
  prompt: string,
  stats: CallStats,
): Promise<WriterOutput> {
  let lastError = 'The model did not return a brief.'
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await call({
      system,
      prompt:
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous reply was not valid JSON for the required shape (${lastError}). Reply again with the JSON object only.`,
    })
    stats.inputTokens += reply.inputTokens
    stats.outputTokens += reply.outputTokens
    stats.passes += 1
    try {
      const parsed = writerOutputSchema.safeParse(extractJsonObject(reply.text))
      if (parsed.success) return parsed.data
      lastError = parsed.error.issues[0]?.message ?? 'invalid shape'
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'unparseable reply'
    }
  }
  throw new BriefGenerationError(`The AI reply could not be read: ${lastError}`)
}

const REF_TEXT = /\s*\[(?:[A-Z]\d{1,4})(?:\s*,\s*[A-Z]\d{1,4})*\]/g

/**
 * Keep only citations that resolve to this run's evidence, strip refs the
 * writer leaked into prose, order sections by the spec, and enforce limits.
 */
export function groundResult(
  output: WriterOutput,
  spec: BriefSpec,
  refs: ReadonlySet<string>,
): { result: Omit<BriefResult, 'notice'>; dropped: number; uncited: number } {
  let dropped = 0
  let uncited = 0
  const clean = (list: string[]) => {
    const kept: string[] = []
    for (const raw of list) {
      const ref = raw.replace(/[[\]\s]/g, '').toUpperCase()
      if (!ref) continue
      if (refs.has(ref)) {
        if (!kept.includes(ref)) kept.push(ref)
      } else dropped++
    }
    return kept
  }
  const sections = spec.sections.map((section) => {
    const written = output.sections.find((s) => s.key === section.key)
    const bullets = (written?.bullets ?? []).slice(0, section.maxBullets).map((bullet) => {
      const cited = clean(bullet.citations)
      if (cited.length === 0) uncited++
      return { text: bullet.text.replace(REF_TEXT, '').trim(), citations: cited }
    })
    return { key: section.key, title: section.title, bullets: bullets.filter((b) => b.text) }
  })
  const followUps = output.followUps.slice(0, 12).map((f) => ({
    action: f.action.replace(REF_TEXT, '').trim(),
    owner: f.owner,
    priority: f.priority,
    citations: clean(f.citations),
  }))
  return {
    result: {
      headline: output.headline.replace(REF_TEXT, '').trim(),
      summary: output.summary.replace(REF_TEXT, '').trim(),
      sections,
      followUps,
      changes: output.changes.slice(0, 10),
    },
    dropped,
    uncited,
  }
}

function emptyResult(spec: BriefSpec, notice: string, headline: string): BriefResult {
  return {
    headline,
    summary: '',
    sections: spec.sections.map((s) => ({ key: s.key, title: s.title, bullets: [] })),
    followUps: [],
    changes: [],
    notice,
  }
}

const UNAVAILABLE_NOTICE: Record<NonNullable<BriefAiAvailability['reason']>, string> = {
  disabled: 'AI is turned off for this workspace, so only the computed figures are shown.',
  unconfigured:
    'AI is not set up for this workspace (Admin → AI), so only the computed figures are shown.',
  budget_reached:
    "This month's AI token budget has been reached (Admin → AI), so only the computed figures are shown.",
}

export async function generateBrief(input: GenerateBriefInput): Promise<GeneratedBrief> {
  const { spec } = input
  const collected: CollectedEvidence = await (input.collect ?? collectEvidence)({
    ctx: input.ctx,
    configs: spec.sources,
    window: input.window,
    scope: input.scope,
  })
  const system = systemPrompt({
    briefName: input.briefName,
    orgName: input.ai.config?.org?.name ?? null,
    spec,
    compare: spec.compareWithPrevious && input.previous !== null,
  })
  const baseMeta: BriefAiMeta = {
    provider: input.ai.config?.provider ?? null,
    model: modelId(input.ai.config, spec.tier),
    tier: spec.tier,
    specVersion: input.specVersion,
    promptHash: promptHash(system, spec),
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    passes: 0,
    droppedCitations: 0,
    uncitedBullets: 0,
    skippedReason: null,
  }

  if (collected.records.length === 0) {
    const what = collected.evidence.sources.map((s) => s.label.toLowerCase()).join(', ')
    return {
      result: emptyResult(
        spec,
        `No ${what} for ${input.window.label}${input.scope.departmentName ? ` in ${input.scope.departmentName}` : ''}.`,
        'Nothing to report',
      ),
      evidence: collected.evidence,
      aiMeta: { ...baseMeta, skippedReason: 'empty' },
      skipped: spec.emptyPolicy === 'skip',
      unavailable: collected.unavailable,
    }
  }

  if (!input.ai.config) {
    const reason = input.ai.reason ?? 'unconfigured'
    return {
      result: emptyResult(spec, UNAVAILABLE_NOTICE[reason], 'AI analysis unavailable'),
      evidence: collected.evidence,
      aiMeta: {
        ...baseMeta,
        skippedReason: reason === 'budget_reached' ? 'budget_reached' : 'ai_unavailable',
      },
      skipped: false,
      unavailable: collected.unavailable,
    }
  }

  const call = input.callModel ?? modelCaller(input.ai.config, spec.tier)
  const stats: CallStats = { inputTokens: 0, outputTokens: 0, passes: 0 }
  const started = Date.now()
  const scopeLabel = input.scope.departmentName ? `Department: ${input.scope.departmentName}` : null
  const chunks = chunkRecords(collected.records, input.charBudget ?? SINGLE_PASS_CHAR_BUDGET)
  let output: WriterOutput
  if (chunks.length === 1) {
    output = await write(
      call,
      system,
      userPrompt({
        windowLabel: input.window.label,
        scopeLabel,
        facts: collected.evidence.facts,
        records: collected.records,
        previous: spec.compareWithPrevious ? input.previous : null,
      }),
      stats,
    )
  } else {
    const partials: WriterOutput[] = []
    for (const chunk of chunks) {
      partials.push(
        await write(
          call,
          system,
          userPrompt({
            windowLabel: input.window.label,
            scopeLabel,
            facts: collected.evidence.facts,
            records: chunk,
            previous: null,
          }),
          stats,
        ),
      )
    }
    output = await write(
      call,
      system,
      userPrompt({
        windowLabel: input.window.label,
        scopeLabel,
        facts: collected.evidence.facts,
        records: [],
        previous: spec.compareWithPrevious ? input.previous : null,
        partials,
      }),
      stats,
    )
  }

  const refs = new Set(collected.records.map((r) => r.ref))
  const grounded = groundResult(output, spec, refs)
  return {
    result: {
      ...grounded.result,
      notice:
        collected.unavailable.length > 0
          ? `Not included — the brief runs as a member who cannot read: ${collected.unavailable.join(', ')}.`
          : null,
    },
    evidence: collected.evidence,
    aiMeta: {
      ...baseMeta,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      latencyMs: Date.now() - started,
      passes: stats.passes,
      droppedCitations: grounded.dropped,
      uncitedBullets: grounded.uncited,
    },
    skipped: false,
    unavailable: collected.unavailable,
  }
}
