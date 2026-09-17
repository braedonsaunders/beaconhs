// In-app product issue reporter destination. Super-admin, deployment-wide —
// not a per-tenant tracker. The GitHub token is sealed at rest (see ./crypto).
// Nothing GitHub-related lives in the environment.

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import { sealSecret, unsealSecret } from '@beaconhs/crypto'
import type { RequestContext } from '@beaconhs/tenant'

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/

type RawFeedback = {
  enabled?: boolean
  owner?: string
  repo?: string
  labels?: string[]
  searchDuplicates?: boolean
  keyCiphertext?: string
  keyNonce?: string
}

export type FeedbackSettings = {
  enabled: boolean
  owner: string
  repo: string
  labels: string
  searchDuplicates: boolean
  hasToken: boolean
  ready: boolean
}

export type FeedbackSettingsInput = {
  enabled: boolean
  owner: string
  repo: string
  labels: string
  searchDuplicates: boolean
  token?: string
}

export type FeedbackRuntime = {
  owner: string
  repo: string
  token: string
  labels: string[]
  searchDuplicates: boolean
}

export function parseFeedbackLabels(value: string): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const part of value.split(',')) {
    const label = part.trim()
    if (!label || label.length > 40 || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    labels.push(label)
    if (labels.length >= 8) break
  }
  return labels
}

export function sanitizeFeedbackSettingsInput(input: FeedbackSettingsInput): FeedbackSettingsInput {
  const owner = input.owner.trim()
  const repo = input.repo.trim()
  if (owner && !OWNER_RE.test(owner)) throw new Error('A valid repository owner is required.')
  if (repo && (!REPO_RE.test(repo) || repo === '.' || repo === '..')) {
    throw new Error('A valid repository name is required.')
  }
  return {
    enabled: input.enabled,
    owner,
    repo,
    labels: parseFeedbackLabels(input.labels).join(', '),
    searchDuplicates: input.searchDuplicates,
    token: input.token?.trim() || undefined,
  }
}

function toSettings(raw: RawFeedback): FeedbackSettings {
  const owner = typeof raw.owner === 'string' ? raw.owner : ''
  const repo = typeof raw.repo === 'string' ? raw.repo : ''
  const hasToken = Boolean(raw.keyCiphertext && raw.keyNonce)
  const enabled = raw.enabled === true
  return {
    enabled,
    owner,
    repo,
    labels: Array.isArray(raw.labels) ? raw.labels.join(', ') : '',
    searchDuplicates: raw.searchDuplicates !== false,
    hasToken,
    ready: enabled && hasToken && Boolean(owner && repo),
  }
}

async function readPlatformFeedback(): Promise<RawFeedback> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ feedback: platformSettings.feedback })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.feedback
    return raw && typeof raw === 'object' ? (raw as RawFeedback) : {}
  })
}

/** UI-facing platform settings (no secret material). */
export async function getPlatformFeedbackSettings(): Promise<FeedbackSettings> {
  return toSettings(await readPlatformFeedback())
}

/** Decrypted destination used by the turn route. Null when reporting is off. */
export async function getPlatformFeedbackRuntime(): Promise<FeedbackRuntime | null> {
  const raw = await readPlatformFeedback()
  if (raw.enabled !== true) return null
  if (!raw.keyCiphertext || !raw.keyNonce) return null
  const owner = typeof raw.owner === 'string' ? raw.owner.trim() : ''
  const repo = typeof raw.repo === 'string' ? raw.repo.trim() : ''
  if (!OWNER_RE.test(owner)) return null
  if (!REPO_RE.test(repo) || repo === '.' || repo === '..') return null
  const token = unsealSecret({ ciphertext: raw.keyCiphertext, nonce: raw.keyNonce })
  if (!token) return null
  return {
    owner,
    repo,
    token,
    labels: Array.isArray(raw.labels)
      ? raw.labels.filter((label): label is string => typeof label === 'string')
      : [],
    searchDuplicates: raw.searchDuplicates !== false,
  }
}

export async function savePlatformFeedbackSettings(input: FeedbackSettingsInput): Promise<void> {
  const validated = sanitizeFeedbackSettingsInput(input)
  const prev = await readPlatformFeedback()
  const next: RawFeedback = {
    enabled: validated.enabled,
    owner: validated.owner || undefined,
    repo: validated.repo || undefined,
    labels: parseFeedbackLabels(validated.labels),
    searchDuplicates: validated.searchDuplicates,
    keyCiphertext: prev.keyCiphertext,
    keyNonce: prev.keyNonce,
  }
  if (validated.token) {
    const sealed = sealSecret(validated.token)
    next.keyCiphertext = sealed.ciphertext
    next.keyNonce = sealed.nonce
  }
  await withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, feedback: next })
      .onConflictDoUpdate({ target: platformSettings.id, set: { feedback: next } })
  })
}

export async function clearPlatformFeedbackToken(): Promise<void> {
  const prev = await readPlatformFeedback()
  const next: RawFeedback = { ...prev, keyCiphertext: undefined, keyNonce: undefined }
  await withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, feedback: next })
      .onConflictDoUpdate({ target: platformSettings.id, set: { feedback: next } })
  })
}

/** Names and emails the reporter must never send to GitHub. */
export async function feedbackDenyList(
  ctx: RequestContext,
  email?: string | null,
): Promise<string[]> {
  const tenantName = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    return row?.name ?? null
  })
  return [tenantName, ctx.membership?.displayName, email].flatMap((value) => {
    const text = value?.trim()
    return text && text.length >= 3 ? [text] : []
  })
}
