import 'server-only'

// AI generation for the Insights builder: a natural-language prompt → a
// validated BHQL query (the same AST the visual builder authors and the
// compiler runs). The model returns JSON which we validate with the SAME
// `parseBhqlQuery` authority used at every server-action boundary, retrying once
// with the validation error fed back. The AI only ever DRAFTS — the result is
// hydrated into the visual builder for a human to refine; nothing auto-saves.
//
// Decoupled from any vendor SDK: the model call goes through the shared
// per-tenant AI plumbing (`runBuilderPrompt` → `getModel`), so every configured
// provider works unchanged.

import { runBuilderPrompt } from '@beaconhs/ai'
import type { AiConfig } from '@beaconhs/ai'
import { BhqlValidationError } from '@beaconhs/analytics'
import { discoverEntities, validateBhql } from '@beaconhs/analytics/server'
import type { BhqlQuery } from '@beaconhs/db/schema'

type GenResult<T> = { ok: true; value: T } | { ok: false; error: string }

// Pull the first JSON object out of a model response (handles ```json fences and
// stray prose around the object).
function extractJson(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1]!.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object found')
  return JSON.parse(t.slice(start, end + 1))
}

// Compact, model-readable dump of the curated registry: one entity per block,
// every queryable column with its kind and eligibility flags. Legend:
//   *  date/timestamp — can bucket by day|week|month|quarter|year
//   +  numeric — can sum/avg (and min/max)
//   {a|b}  enum value options (when known)
function shortKind(kind: string): string {
  return kind === 'number' ? 'num' : kind === 'timestamp' ? 'ts' : kind === 'uuid' ? 'id' : kind
}

function serializeEntities(): string {
  // The headline (primary) entities keep the prompt tight; validation still
  // accepts ANY discovered table if the model targets one.
  return discoverEntities()
    .filter((e) => e.primary)
    .map((e) => {
      const cols = e.columns
        .map((c) => {
          const flags = `${c.canBinTemporal ? '*' : ''}${c.canMeasure ? '+' : ''}`
          const opts = c.enumOptions?.length
            ? `{${c.enumOptions.map((o) => o.value).join('|')}}`
            : ''
          return `${c.key}(${shortKind(c.kind)}${flags})${opts}`
        })
        .join(' ')
      return `- ${e.key} — ${e.description}\n    ${cols}`
    })
    .join('\n')
}

const ENTITY_CATALOGUE = serializeEntities()

const BHQL_SYSTEM = `You translate a natural-language analytics request into a BHQL query for BeaconHS, a construction & industrial health-and-safety platform. Output a SINGLE JSON object matching this TypeScript shape and NOTHING else (no prose, no markdown fences):

type BhqlQuery = {
  version: "bhql/1"
  display: "table" | "pivot"
  pivot?: null | { rows: {breakout:string}[]; columns: {breakout:string}[]; values: {measure:string}[] }
  stages: [ Stage ]                       // EXACTLY ONE stage
}
type Stage = {
  source: string                          // an entity key from the catalogue below
  filter?: null | RuleGroup
  breakouts?: Breakout[]                  // group-by dimensions (the X axis / pivot keys)
  aggregations?: Measure[]                // the measures (the Y values)
  columns?: string[]                      // RAW-ROW mode only: entity column keys to list as-is
  orderBy?: { ref: string; direction: "asc"|"desc" }[]   // ref = an alias (or a column key in raw mode)
  limit?: number | null
}
type Measure = { fn: "count"|"count_distinct"|"sum"|"avg"|"min"|"max"; field?: string; alias: string }
type Breakout = { field: string; alias: string; bin?: { kind:"temporal"; unit:"day"|"week"|"month"|"quarter"|"year" } | { kind:"numeric"; numBins:number } }
type RuleGroup = { combinator: "and"|"or"; not?: boolean; rules: (Rule | RuleGroup)[] }
type Rule = { field: string; op: Op; value?: unknown }
Op = "eq" | "neq" | "in" | "gte" | "lte" | "is_null" | "is_not_null" | "contains"

Rules:
- Exactly one stage. Choose the SINGLE best-fitting "source" entity and only reference fields that exist on it.
- The common request shape is "<thing> by <dimension>": put the dimension in "breakouts" and a measure in "aggregations". To count records use { "fn":"count", "alias":"count" } (count takes NO field).
- A time series ("by month/week/day/quarter/year", "over time", "trend") = breakout the date/timestamp field (flagged *) with the matching temporal bin.
- "sum/total/average of X" → use fn "sum"/"avg" with a numeric field (flagged +). "min"/"max"/"count_distinct" accept any field.
- Every alias is unique lower_snake_case. orderBy.ref must be one of your aliases (or a listed column in raw mode).
- Use "columns" ONLY for a plain list of records with no grouping/aggregation; never combine "columns" with breakouts/aggregations.
- Filters: "eq"/"neq" match a single value; "in" takes an array of allowed values; "gte"/"lte" compare dates (ISO "YYYY-MM-DD") or numbers; "is_null"/"is_not_null" take no value; "contains" matches a text substring.
- For relative date ranges, compute absolute ISO bounds from the provided "Today" date and use "gte"/"lte" — e.g. "this year" → gte the Jan 1 of that year; "last 30 days" → gte the date 30 days before Today.
- "display" is "table" unless you are cross-tabbing TWO breakouts into a matrix; then set "pivot" and fill pivot.rows/columns with breakout aliases and pivot.values with measure aliases (needs ≥2 breakouts and ≥1 measure).
- Output ONLY the JSON object.

Entities (key — description; then columns as name(kind[flags]); * = time-bucketable, + = numeric/summable, {…} = enum options):
${ENTITY_CATALOGUE}`

/** NL prompt → validated BhqlQuery. Retries once, feeding the validation error
 *  back to the model. `today` (ISO YYYY-MM-DD) anchors relative date ranges. */
export async function generateBhqlFromPrompt(
  config: AiConfig | null | undefined,
  prompt: string,
  today: string,
): Promise<GenResult<BhqlQuery>> {
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = `Today is ${today}. Build a BHQL query for: ${prompt}`
    const userPrompt =
      attempt === 0
        ? base
        : `${base}\n\nYour previous JSON was invalid (${lastErr}). Return corrected JSON only.`
    const text = await runBuilderPrompt(config, {
      system: BHQL_SYSTEM,
      prompt: userPrompt,
      tier: 'smart',
    })
    if (!text) {
      return {
        ok: false,
        error: 'AI is not configured for this workspace, or the model did not respond.',
      }
    }
    let json: unknown
    try {
      json = extractJson(text)
    } catch {
      lastErr = 'response was not valid JSON'
      continue
    }
    try {
      return { ok: true, value: validateBhql(json) }
    } catch (e) {
      lastErr = e instanceof BhqlValidationError || e instanceof Error ? e.message : 'invalid query'
    }
  }
  return { ok: false, error: `The AI returned an invalid query: ${lastErr}` }
}
