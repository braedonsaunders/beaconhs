// Builds the per-turn AI-SDK ToolSet. The model only ever SEES tools the current
// user may run (first gate); every execute() re-checks the gate (second gate);
// write tools add a third gate at commit time in _commit-actions.ts. Vision tools
// (needsImageToolResults) add a fourth gate: they are withheld unless the active
// provider accepts image content in a tool result — see ToolCapabilities.

import { tool, type ToolSet } from 'ai'
import type { RequestContext } from '@beaconhs/tenant'
import { canRunTool } from './gate'
import { READ_TOOLS } from './tools'
import { WRITE_TOOLS } from './tools-write'
import type { AssistantToolDef, ToolResult, VisionToolData } from './types'

export const ASSISTANT_TOOLS: AssistantToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS]

/** Provider-derived capabilities that change which tools are exposed this turn. */
export type ToolCapabilities = {
  /** The provider accepts IMAGE content in a tool result (Anthropic). When false,
   *  vision tools are withheld so the model never calls one the API would reject. */
  imageToolResults: boolean
}

function safeErrorMessage(e: unknown): string {
  // Never surface raw error text to the model — it could carry secrets/PII.
  if (e instanceof Error && e.name === 'ForbiddenError') return 'forbidden'
  return 'tool_failed'
}

/** Map a vision tool's result to model-facing content: its rendered page images
 *  as image parts (Anthropic turns these into image blocks), plus an optional
 *  text summary. Falls back to a short text note on failure or when empty. */
function visionToModelOutput(output: ToolResult) {
  if (output.ok === false) {
    return {
      type: 'content' as const,
      value: [{ type: 'text' as const, text: `Could not render the page(s): ${output.error}.` }],
    }
  }
  const data = output.data as VisionToolData
  const value: Array<
    { type: 'text'; text: string } | { type: 'image-data'; data: string; mediaType: string }
  > = []
  if (data.summary) value.push({ type: 'text', text: data.summary })
  for (const img of data.images ?? []) {
    value.push({ type: 'image-data', data: img.base64, mediaType: img.mediaType })
  }
  if (value.length === 0) value.push({ type: 'text', text: 'No pages were rendered.' })
  return { type: 'content' as const, value }
}

/** Construct the tenant-bound tool set the model may use this turn. */
export function buildToolRegistry(ctx: RequestContext, caps: ToolCapabilities): ToolSet {
  const runnable = ASSISTANT_TOOLS.filter(
    (t) => canRunTool(ctx, t) && (!t.needsImageToolResults || caps.imageToolResults),
  )
  const entries = runnable.map((t) => {
    // Shared execute wrapper: defensive gate re-check + never-throw contract.
    const execute = async (args: unknown): Promise<ToolResult> => {
      if (!canRunTool(ctx, t)) return { ok: false, error: 'forbidden' }
      try {
        return await t.execute(args, ctx)
      } catch (e) {
        console.warn(`[assistant] tool ${t.name} failed`, e)
        return { ok: false, error: safeErrorMessage(e) }
      }
    }
    const def = t.needsImageToolResults
      ? tool({
          description: t.description,
          inputSchema: t.inputSchema,
          execute,
          toModelOutput: ({ output }) => visionToModelOutput(output),
        })
      : tool({ description: t.description, inputSchema: t.inputSchema, execute })
    return [t.name, def] as const
  })
  return Object.fromEntries(entries)
}

/** Names of the tools this user may run — lets the caller know if any exist. */
export function runnableToolNames(ctx: RequestContext): string[] {
  return ASSISTANT_TOOLS.filter((t) => canRunTool(ctx, t)).map((t) => t.name)
}
