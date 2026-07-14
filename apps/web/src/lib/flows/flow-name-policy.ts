export const MAX_FLOW_NAME_LENGTH = 200

type FlowNameResult = { ok: true; name: string } | { ok: false; error: string }

export function parseFlowName(value: unknown): FlowNameResult {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name.length > MAX_FLOW_NAME_LENGTH) {
    return {
      ok: false,
      error: `Flow name cannot exceed ${MAX_FLOW_NAME_LENGTH} characters`,
    }
  }
  return { ok: true, name: name || 'Flow' }
}
