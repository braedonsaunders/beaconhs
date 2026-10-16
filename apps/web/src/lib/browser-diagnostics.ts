import { routeFamily, safeDigest, safeErrorType, safeStaticPositions } from './diagnostic-safety'

type BrowserDiagnosticKind =
  | 'unhandled_error'
  | 'unhandled_rejection'
  | 'react_boundary'
  | 'deployment_stale'
  | 'smoke'
  | 'event_loop_delay'

let deviceId: string | undefined
let windowStartedAt = 0
let sentInWindow = 0
const recent = new Map<string, number>()

function diagnosticDeviceId(): string {
  if (deviceId) return deviceId
  try {
    const stored = localStorage.getItem('bhs-diagnostic-device')
    if (stored && /^[a-f0-9-]{36}$/.test(stored)) deviceId = stored
    else {
      deviceId = crypto.randomUUID()
      localStorage.setItem('bhs-diagnostic-device', deviceId)
    }
  } catch {
    deviceId = crypto.randomUUID()
  }
  return deviceId
}

/** No message, page URL, query, form value, cookie or full stack leaves the browser. */
export function captureBrowserDiagnostic(
  kind: BrowserDiagnosticKind,
  error?: unknown,
  detail?: { reason?: 'version_mismatch' | 'action_not_found'; delayMs?: number },
): void {
  try {
    if (typeof window === 'undefined') return
    // Cancellations during navigation/prefetch are expected, not crashes.
    const candidate = error && typeof error === 'object' ? error : undefined
    const name = candidate && 'name' in candidate ? candidate.name : undefined
    if (name === 'AbortError' || name === 'DeploymentChangedError') return
    const release = document.documentElement.dataset.dplId
    const payload = {
      kind,
      routeFamily: routeFamily(window.location.pathname),
      deviceId: diagnosticDeviceId(),
      clientRelease: release && /^[a-f0-9]{40}$/.test(release) ? release : undefined,
      errorType: safeErrorType(name),
      digest: safeDigest(candidate && 'digest' in candidate ? candidate.digest : undefined),
      positions: safeStaticPositions(
        candidate && 'stack' in candidate ? candidate.stack : undefined,
        candidate && 'message' in candidate ? candidate.message : undefined,
      ),
      reason: detail?.reason,
      delayMs: detail?.delayMs,
    }
    const now = Date.now()
    if (now - windowStartedAt >= 60_000) {
      windowStartedAt = now
      sentInWindow = 0
      recent.clear()
    }
    const fingerprint = JSON.stringify(payload)
    if (sentInWindow >= 10 || now - (recent.get(fingerprint) ?? 0) < 10_000) return
    recent.set(fingerprint, now)
    sentInWindow++
    void fetch('/api/diagnostics', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: fingerprint,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Storage, network and serialization failures must never affect the user.
  }
}

/** A delayed callback is evidence of an unresponsive visible page, not a crash.
 * Ignore hidden tabs and long gaps caused by browser suspension or laptop sleep. */
function startEventLoopDiagnostics(): () => void {
  const intervalMs = 2_000
  let expectedAt = performance.now() + intervalMs
  let visible = document.visibilityState === 'visible'
  let timer: ReturnType<typeof setInterval> | undefined
  function reset() {
    expectedAt = performance.now() + intervalMs
    visible = document.visibilityState === 'visible'
  }
  function start() {
    reset()
    if (timer !== undefined) return
    timer = setInterval(() => {
      const now = performance.now()
      const delayMs = Math.round(now - expectedAt)
      const wasVisible = visible
      reset()
      if (wasVisible && visible && delayMs >= 3_000 && delayMs <= 30_000) {
        captureBrowserDiagnostic('event_loop_delay', undefined, { delayMs })
      }
    }, intervalMs)
  }
  function stop() {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    visible = false
  }
  document.addEventListener('visibilitychange', reset)
  window.addEventListener('focus', reset)
  window.addEventListener('pagehide', stop)
  window.addEventListener('pageshow', start)
  start()
  return () => {
    stop()
    document.removeEventListener('visibilitychange', reset)
    window.removeEventListener('focus', reset)
    window.removeEventListener('pagehide', stop)
    window.removeEventListener('pageshow', start)
  }
}

export function registerBrowserDiagnostics(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onError = (event: ErrorEvent) => captureBrowserDiagnostic('unhandled_error', event.error)
  const onRejection = (event: PromiseRejectionEvent) =>
    captureBrowserDiagnostic('unhandled_rejection', event.reason)
  const onStale = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    const reason =
      detail && typeof detail === 'object' && 'reason' in detail ? detail.reason : undefined
    if (reason === 'version_mismatch' || reason === 'action_not_found') {
      captureBrowserDiagnostic('deployment_stale', undefined, { reason })
    }
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('beaconhs:deployment-stale', onStale)
  const stopHeartbeat = startEventLoopDiagnostics()
  return () => {
    stopHeartbeat()
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('beaconhs:deployment-stale', onStale)
  }
}
