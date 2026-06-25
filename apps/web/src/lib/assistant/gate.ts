// Permission gating for assistant tools. The model is only ever handed tools the
// current user may run; execute() re-checks the same gate defensively.

import { can } from '@beaconhs/tenant'
import type { RequestContext } from '@beaconhs/tenant'
import type { AssistantToolDef, PermissionRule } from './types'

export function passesGate(ctx: RequestContext, gate: PermissionRule): boolean {
  switch (gate.mode) {
    case 'public':
      return true
    case 'anyOf':
      return gate.perms.some((p) => can(ctx, p))
    case 'allOf':
      return gate.perms.every((p) => can(ctx, p))
  }
}

/** A tool is runnable iff the user holds assistant.use, plus assistant.write for
 *  write tools, plus the tool's own gate. */
export function canRunTool(ctx: RequestContext, tool: AssistantToolDef): boolean {
  if (!can(ctx, 'assistant.use')) return false
  if (tool.category === 'write' && !can(ctx, 'assistant.write')) return false
  return passesGate(ctx, tool.gate)
}
