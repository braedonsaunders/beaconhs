import 'server-only'

import { resolvePublicHost, type OutboundDnsResolver } from '@beaconhs/sync/egress'
import { normalizeTrainingExternalUrl } from './training-external-url'

const CONFIGURED_ORIGIN_KEYS = [
  'PUBLIC_APP_URL',
  'NEXT_PUBLIC_APP_URL',
  'APP_URL',
  'BETTER_AUTH_URL',
  'COLLABORA_URL',
  'COLLABORA_WOPI_URL',
] as const
const TRAINING_URL_DNS_TIMEOUT_MS = 5_000

type TrainingUrlEnvironment = Readonly<Record<string, string | undefined>>

function configuredOrigin(key: (typeof CONFIGURED_ORIGIN_KEYS)[number], value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) URL.`)
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error(`${key} must be a credential-free HTTP(S) URL.`)
  }
  return url.origin
}

export function configuredTrainingBlockedOrigins(
  environment: TrainingUrlEnvironment = process.env,
): string[] {
  return [
    ...new Set(
      CONFIGURED_ORIGIN_KEYS.flatMap((key) => {
        const value = environment[key]?.trim()
        return value ? [configuredOrigin(key, value)] : []
      }),
    ),
  ]
}

/**
 * Validate immediately before persistence. The browser never receives a link
 * that failed syntax/origin policy, and DNS must resolve exclusively to public
 * addresses at save time so private and rebinding-style hostnames are refused.
 */
export async function validateTrainingExternalUrl(
  input: string,
  options: {
    environment?: TrainingUrlEnvironment
    resolver?: OutboundDnsResolver
    timeoutMs?: number
  } = {},
): Promise<string> {
  const normalized = normalizeTrainingExternalUrl(input, {
    blockedOrigins: configuredTrainingBlockedOrigins(options.environment),
  })
  try {
    await resolvePublicHost(new URL(normalized.url).hostname, {
      resolver: options.resolver,
      timeoutMs: options.timeoutMs ?? TRAINING_URL_DNS_TIMEOUT_MS,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Host validation failed.'
    throw new Error(`Training link must resolve only to public addresses. ${detail}`)
  }
  return normalized.url
}
