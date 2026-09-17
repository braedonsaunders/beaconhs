// Pure and client-safe, unlike `appVersion()` which reads the environment.

const GIT_SHA = /^[0-9a-f]{40}$/

/**
 * Short form for display.
 *
 * The deploy stamps a full 40-character commit SHA, which is unreadable in a
 * menu; the first seven identify the commit unambiguously in practice and are
 * what anyone would paste into `git show`. Anything that is not a SHA — `dev`
 * on a local run — is shown as-is.
 */
export function formatAppVersion(version: string): string {
  const trimmed = version.trim()
  return GIT_SHA.test(trimmed) ? trimmed.slice(0, 7) : trimmed
}
