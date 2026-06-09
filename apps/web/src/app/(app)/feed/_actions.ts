'use server'

// Thin client-callable wrapper for paging the activity feed. Visibility is
// enforced inside getFeed (per-module scope), so no extra gate is needed beyond
// an authenticated request context.

import { requireRequestContext } from '@/lib/auth'
import { getFeed } from './_data'
import type { FeedPage } from './_types'

export async function fetchFeedPage(cursor: string | null): Promise<FeedPage> {
  const ctx = await requireRequestContext()
  return getFeed(ctx, { cursor })
}
