import { automationGraphSchema, type AutomationGraph } from '@beaconhs/forms-core'
import { isUuid } from '../list-params'
import { moduleFlowProfile } from './module-profiles'

export type FlowSubjectRef = { type: 'form_template' | 'module'; key: string }

const MAX_GRAPH_BYTES = 1024 * 1024
const MAX_GRAPH_NODES = 250
const MAX_GRAPH_EDGES = 500
const MAX_GRAPH_ID_LENGTH = 128

export function parseFlowSubject(value: unknown): FlowSubjectRef | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { type?: unknown; key?: unknown }
  if (candidate.type !== 'form_template' && candidate.type !== 'module') return null
  if (typeof candidate.key !== 'string' || !candidate.key) return null
  if (candidate.type === 'form_template') {
    return isUuid(candidate.key) ? { type: candidate.type, key: candidate.key } : null
  }
  return moduleFlowProfile(candidate.key) ? { type: candidate.type, key: candidate.key } : null
}

type FlowGraphResult = { ok: true; graph: AutomationGraph } | { ok: false; error: string }

/**
 * Validate the graph's persistence boundary, not just its TypeScript shape.
 * Drafts may intentionally have no trigger yet, but stored edges must always
 * refer to unique, real nodes and the payload must stay within operational
 * limits. Runtime-specific trigger/action compatibility is checked by the
 * caller once the owning subject is known.
 */
export function parseFlowGraph(value: unknown): FlowGraphResult {
  const parsed = automationGraphSchema.safeParse(value)
  if (!parsed.success) return { ok: false, error: 'Invalid flow graph' }

  let bytes: number
  try {
    bytes = new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength
  } catch {
    return { ok: false, error: 'Invalid flow graph' }
  }
  if (bytes > MAX_GRAPH_BYTES) {
    return { ok: false, error: 'Flow graph exceeds the 1 MB storage limit' }
  }
  if (parsed.data.nodes.length > MAX_GRAPH_NODES) {
    return { ok: false, error: `Flow graph cannot contain more than ${MAX_GRAPH_NODES} nodes` }
  }
  if (parsed.data.edges.length > MAX_GRAPH_EDGES) {
    return { ok: false, error: `Flow graph cannot contain more than ${MAX_GRAPH_EDGES} edges` }
  }

  const nodeIds = new Set<string>()
  let hasTrigger = false
  for (const node of parsed.data.nodes) {
    if (!node.id || node.id.length > MAX_GRAPH_ID_LENGTH || nodeIds.has(node.id)) {
      return { ok: false, error: 'Flow graph contains an invalid or duplicate node id' }
    }
    nodeIds.add(node.id)
    if (node.data.kind === 'trigger') hasTrigger = true
  }
  if (parsed.data.nodes.length > 0 && !hasTrigger) {
    return { ok: false, error: 'Flow graph must contain a trigger' }
  }

  const edgeIds = new Set<string>()
  for (const edge of parsed.data.edges) {
    if (!edge.id || edge.id.length > MAX_GRAPH_ID_LENGTH || edgeIds.has(edge.id)) {
      return { ok: false, error: 'Flow graph contains an invalid or duplicate edge id' }
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return { ok: false, error: 'Flow graph contains an edge to a missing node' }
    }
    edgeIds.add(edge.id)
  }

  return { ok: true, graph: parsed.data }
}
