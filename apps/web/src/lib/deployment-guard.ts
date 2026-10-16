// Server Action IDs belong to one build. Check before sending a mutation from
// an old tab, and never replay an action whose side effects may have happened.
// Native field autosaves use version-independent routes and remain available.

export type DeploymentStaleReason = 'version_mismatch' | 'action_not_found'
export const DEPLOYMENT_STALE_EVENT = 'beaconhs:deployment-stale'
const CHECK_INTERVAL_MS = 15_000
const CHECK_TIMEOUT_MS = 3_000
const RELEASE = /^[a-f0-9]{40}$/

class DeploymentChangedError extends Error {
  constructor() {
    super('BeaconHS has been updated. Refresh the app before continuing.')
    this.name = 'DeploymentChangedError'
  }
}

export function createDeploymentGuard({
  version,
  origin,
  fetch: originalFetch,
  onStale,
  now = Date.now,
}: {
  version: string
  origin: string
  fetch: typeof fetch
  onStale: (reason: DeploymentStaleReason) => void
  now?: () => number
}) {
  let stale = false
  let checkedAt: number | null = null
  let checking: Promise<void> | null = null

  function markStale(reason: DeploymentStaleReason) {
    if (stale) return
    stale = true
    onStale(reason)
  }

  async function check() {
    if (stale || !RELEASE.test(version)) return
    if (checkedAt !== null && now() - checkedAt < CHECK_INTERVAL_MS) return
    checking ??= (async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
      try {
        const response = await originalFetch(new URL('/api/app-version', origin), {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!response.ok) return
        const body: unknown = await response.json()
        if (!body || typeof body !== 'object' || !('version' in body)) return
        const remote = body.version
        if (typeof remote !== 'string' || !RELEASE.test(remote)) return
        checkedAt = now()
        if (remote !== version) markStale('version_mismatch')
      } catch {
        // An unavailable probe is not evidence of a new build. The original
        // action still has its normal offline/auth/error behavior.
      } finally {
        clearTimeout(timer)
      }
    })().finally(() => {
      checking = null
    })
    await checking
  }

  const guardedFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input), origin)
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? request?.headers)
    const action = url.origin === origin && method === 'POST' && headers.has('next-action')
    if (!action) return originalFetch(input, init)
    await check()
    if (stale) throw new DeploymentChangedError()
    const response = await originalFetch(input, init)
    if (response.headers.get('x-nextjs-action-not-found') === '1') {
      markStale('action_not_found')
      throw new DeploymentChangedError()
    }
    return response
  }

  return { fetch: guardedFetch, check, isStale: () => stale }
}

let installed: ReturnType<typeof createDeploymentGuard> | null = null

export function deploymentIsStale(): boolean {
  return installed?.isStale() ?? false
}

/** Never reload during a pending save. Failed uploads/actions may themselves
 * need the new build, so leave an explicit, warned escape from that deadlock. */
export async function refreshAfterDeployment({
  flush,
  confirmUnsent,
  reload,
}: {
  flush: () => Promise<void>
  confirmUnsent: () => Promise<boolean>
  reload: () => void
}): Promise<boolean> {
  try {
    await flush()
  } catch {
    if (!(await confirmUnsent())) return false
  }
  reload()
  return true
}

/** Called before hydration and, as a fallback, by the authenticated shell. */
export function installDeploymentGuard(version?: string) {
  if (installed || typeof window === 'undefined') return installed
  const build = document.documentElement.dataset.dplId || version
  if (!build || !RELEASE.test(build)) return null
  installed = createDeploymentGuard({
    version: build,
    origin: window.location.origin,
    fetch: window.fetch.bind(window),
    onStale: (reason) =>
      window.dispatchEvent(new CustomEvent(DEPLOYMENT_STALE_EVENT, { detail: { reason } })),
  })
  window.fetch = installed.fetch
  return installed
}
