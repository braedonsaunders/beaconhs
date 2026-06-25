// Builds the per-turn AI-SDK ToolSet. The model only ever SEES tools the current
// user may run (first gate); every execute() re-checks the gate (second gate);
// write tools add a third gate at commit time in _commit-actions.ts.

import { tool, type ToolSet } from 'ai'
import type { RequestContext } from '@beaconhs/tenant'
import { canRunTool } from './gate'
import { READ_TOOLS } from './tools'
import { WRITE_TOOLS } from './tools-write'
import type { AssistantToolDef } from './types'

export const ASSISTANT_TOOLS: AssistantToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS]

function safeErrorMessage(e: unknown): string {
  // Never surface raw error text to the model — it could carry secrets/PII.
  if (e instanceof Error && e.name === 'ForbiddenError') return 'forbidden'
  return 'tool_failed'
}

/** Construct the tenant-bound tool set the model may use this turn. */
export function buildToolRegistry(ctx: RequestContext): ToolSet {
  const runnable = ASSISTANT_TOOLS.filter((t) => canRunTool(ctx, t))
  const entries = runnable.map((t) => {
    const def = tool({
      description: t.description,
      inputSchema: t.inputSchema,
      execute: async (args: unknown) => {
        // Defensive re-check even though it was filtered IN — closes the gap if a
        // future refactor ever passes a stale list.
        if (!canRunTool(ctx, t)) return { ok: false, error: 'forbidden' }
        try {
          return await t.execute(args, ctx)
        } catch (e) {
          console.warn(`[assistant] tool ${t.name} failed`, e)
          return { ok: false, error: safeErrorMessage(e) }
        }
      },
    })
    return [t.name, def] as const
  })
  return Object.fromEntries(entries)
}

/** Names of the tools this user may run — lets the caller know if any exist. */
export function runnableToolNames(ctx: RequestContext): string[] {
  return ASSISTANT_TOOLS.filter((t) => canRunTool(ctx, t)).map((t) => t.name)
}
