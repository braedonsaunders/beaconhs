import 'server-only'

// Which build this instance is running.
//
// Two env vars carry it for historical reasons: DEPLOYMENT_VERSION is baked
// into the image at build time (Dockerfile ARG, validated as a 40-hex SHA) and
// APP_VERSION is set on the running service. They hold the same commit, so this
// reads whichever is present rather than making callers guess.

/** The running build's git SHA, or `dev` when neither is set. */
export function appVersion(): string {
  return process.env.DEPLOYMENT_VERSION?.trim() || process.env.APP_VERSION?.trim() || 'dev'
}
