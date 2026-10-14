import { createHash } from 'node:crypto'
import type {
  BriefEvidence,
  BriefEvidenceRecord,
  BriefFact,
  BriefSourceConfig,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { BriefValidationError } from '../spec'
import type { ResolvedBriefWindow } from '../window'
import { journalsSource } from './journals'
import {
  correctiveActionsSource,
  hazardAssessmentsSource,
  incidentsSource,
  inspectionsSource,
  ppeInspectionsSource,
  workOrdersSource,
} from './operations'
import type { BriefSourceDefinition, BriefSourceRecord, BriefSourceScope } from './types'

export type { BriefSourceParamField } from './types'

/** A source with its params erased — params are validated by its own schema. */
type AnySource = BriefSourceDefinition<Record<string, unknown>>

function erase<P extends Record<string, unknown>>(source: BriefSourceDefinition<P>): AnySource {
  return source as unknown as AnySource
}

export const BRIEF_SOURCES: readonly AnySource[] = [
  erase(journalsSource),
  erase(incidentsSource),
  erase(correctiveActionsSource),
  erase(inspectionsSource),
  erase(ppeInspectionsSource),
  erase(hazardAssessmentsSource),
  erase(workOrdersSource),
]

const BY_KEY = new Map(BRIEF_SOURCES.map((source) => [source.key, source]))

export function getBriefSource(key: string): AnySource | null {
  return BY_KEY.get(key) ?? null
}

/** Records per source sent to the writer; more are counted as truncated. */
export const SOURCE_RECORD_LIMIT = 400

/** Validate each configured source's params; unknown sources are rejected. */
export function normalizeSourceConfigs(configs: BriefSourceConfig[]): BriefSourceConfig[] {
  return configs.map((config) => {
    const source = getBriefSource(config.key)
    if (!source) throw new BriefValidationError(`Unknown data source "${config.key}"`)
    const parsed = source.params.safeParse({ ...source.defaultParams, ...config.params })
    if (!parsed.success) {
      throw new BriefValidationError(
        `${source.label}: ${parsed.error.issues[0]?.message ?? 'invalid settings'}`,
      )
    }
    return { key: source.key, params: parsed.data as Record<string, unknown> }
  })
}

export type CollectedEvidence = {
  evidence: BriefEvidence
  /** Writer-facing records, keyed by citation ref. */
  records: Array<BriefSourceRecord & { ref: string; source: string; sourceLabel: string }>
  /** Sources the run-as member cannot read. */
  unavailable: string[]
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 280 ? `${clean.slice(0, 279)}…` : clean
}

/**
 * Run every configured source inside one tenant transaction and assemble the
 * evidence: stable citation refs (J1, I1, …), facts, per-source counts, and a
 * content hash over exactly what the writer will read.
 */
export async function collectEvidence(args: {
  ctx: RequestContext
  configs: BriefSourceConfig[]
  window: ResolvedBriefWindow
  scope: BriefSourceScope & { departmentName: string | null }
}): Promise<CollectedEvidence> {
  const { ctx, configs, window, scope } = args
  const facts: BriefFact[] = []
  const sources: BriefEvidence['sources'] = []
  const records: CollectedEvidence['records'] = []
  const unavailable: string[] = []

  await ctx.db(async (tx) => {
    for (const config of normalizeSourceConfigs(configs)) {
      const source = getBriefSource(config.key)!
      if (!source.canRead(ctx)) {
        unavailable.push(source.label)
        sources.push({ key: source.key, label: source.label, count: 0, truncated: 0 })
        continue
      }
      const collected = await source.collect({
        ctx,
        tx,
        window,
        params: config.params,
        scope: { departmentId: scope.departmentId },
        limit: SOURCE_RECORD_LIMIT,
      })
      collected.records.forEach((record, index) => {
        records.push({
          ...record,
          ref: `${source.citationPrefix}${index + 1}`,
          source: source.key,
          sourceLabel: source.label,
        })
      })
      facts.push(...collected.facts)
      sources.push({
        key: source.key,
        label: source.label,
        count: collected.records.length,
        truncated: collected.truncated,
      })
    }
  })

  const evidenceRecords: BriefEvidenceRecord[] = records.map((r) => ({
    ref: r.ref,
    source: r.source,
    id: r.id,
    path: r.path,
    date: r.date,
    title: r.title,
    author: r.author,
    department: r.department,
    site: r.site,
    status: r.status,
    excerpt: excerpt(r.text),
  }))
  const contentHash = createHash('sha256')
    .update(JSON.stringify(records.map((r) => [r.ref, r.id, r.title, r.text])))
    .digest('hex')

  return {
    records,
    unavailable,
    evidence: {
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        label: window.label,
        timezone: window.timezone,
      },
      scope: { departmentId: scope.departmentId, departmentName: scope.departmentName },
      facts,
      sources,
      records: evidenceRecords,
      contentHash,
    },
  }
}
