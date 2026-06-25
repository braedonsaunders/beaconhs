// HMAC-signed write proposals. A draft tool builds a `preview` and signs it; the
// commit server action re-hashes the client-returned preview and rejects any
// tampering or expiry. The signing key is derived from BETTER_AUTH_SECRET (same
// approach as lib/crypto.ts) — no new env var, no secret in the DB.

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { RequestContext } from '@beaconhs/tenant'

const SOURCE = process.env.BETTER_AUTH_SECRET || 'beaconhs-dev-insecure-secret'
const KEY = Buffer.from(
  hkdfSync('sha256', Buffer.from(SOURCE), Buffer.alloc(0), Buffer.from('beaconhs.proposal.v1'), 32),
)
const TTL_MS = 15 * 60 * 1000 // a draft is good for 15 minutes

export type ProposalKind = 'create_corrective_action' | 'create_incident'

export type CaSeverity = 'low' | 'medium' | 'high' | 'critical'
export type CaSource =
  | 'inspection'
  | 'incident'
  | 'near_miss'
  | 'observation'
  | 'audit'
  | 'jsha'
  | 'other'
export type IncidentType =
  | 'injury'
  | 'illness'
  | 'near_miss'
  | 'property_damage'
  | 'environmental'
  | 'security'
  | 'other'
export type IncidentSeverity =
  | 'first_aid_only'
  | 'medical_aid'
  | 'lost_time'
  | 'fatality'
  | 'no_injury'

export type CaPreview = {
  title: string
  description: string | null
  severity: CaSeverity
  source: CaSource
  sourceEntityType: string | null
  sourceEntityId: string | null
  siteOrgUnitId: string | null
  dueOn: string | null
}

export type IncidentPreview = {
  title: string
  description: string | null
  type: IncidentType
  severity: IncidentSeverity
  occurredAt: string
  location: string | null
}

/** Deterministic JSON (recursively sorted keys) so a re-sent preview hashes the
 *  same on the server regardless of property order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`
}

function hmacHex(body: string): string {
  return createHmac('sha256', KEY).update(body).digest('hex')
}

export function signProposal(kind: ProposalKind, preview: unknown, ctx: RequestContext): string {
  const exp = Date.now() + TTL_MS
  const sig = hmacHex(canonical({ kind, preview, userId: ctx.userId, tenantId: ctx.tenantId, exp }))
  return Buffer.from(JSON.stringify({ exp, sig })).toString('base64url')
}

export function verifyProposal(
  kind: ProposalKind,
  preview: unknown,
  token: string,
  ctx: RequestContext,
): boolean {
  let parsed: { exp?: number; sig?: string }
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if (typeof parsed.exp !== 'number' || typeof parsed.sig !== 'string') return false
  if (Date.now() > parsed.exp) return false
  const expected = hmacHex(
    canonical({ kind, preview, userId: ctx.userId, tenantId: ctx.tenantId, exp: parsed.exp }),
  )
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(parsed.sig, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
