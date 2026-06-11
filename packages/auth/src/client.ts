import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'

// In the browser, default to the current page origin so auth requests are
// always same-origin — correct on any host and https-safe. (NEXT_PUBLIC_APP_URL
// is inlined at build time; when it isn't set, the old `?? localhost` fallback
// silently shipped a client that POSTs to http://localhost:3000 → "failed to
// fetch" on a deployed https host.) The localhost fallback now only applies to
// non-browser/SSR module evaluation, where signIn() is never actually called.
const baseURL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')

export const authClient = createAuthClient({
  baseURL,
  plugins: [magicLinkClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient
