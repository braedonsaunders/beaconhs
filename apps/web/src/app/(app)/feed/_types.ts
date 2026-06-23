// Pure, serializable types for the activity feed — shared by the server
// aggregator (_data.ts) and the client timeline (_feed.tsx). No runtime imports.

export type FeedKind = 'journal' | 'incident' | 'corrective_action' | 'form'

export type FeedTag = { name: string; color: string | null }

export type FeedEvent = {
  /** Globally-unique across sources: `${kind}:${rowId}`. */
  id: string
  kind: FeedKind
  /** ISO timestamp the feed is ordered by (submitted / reported / created). */
  at: string
  /** "Verb" describing what happened, e.g. "submitted a journal". */
  action: string
  actorName: string | null
  siteName: string | null
  title: string
  snippet: string | null
  /** Short status/severity pill, e.g. "Closed", "Reported". */
  badge: string | null
  href: string
  /** Journal-only extras. */
  tags?: FeedTag[]
  photoUrls?: string[]
  photoCount?: number
}

export type FeedPage = { events: FeedEvent[]; nextCursor: string | null }

/**
 * Lightweight activity rollup for the feed's summary rail. Counts are scoped the
 * same way as the timeline itself (per-module visibility), so they never reveal
 * more than the timeline would.
 */
export type FeedSummary = {
  /** Events per kind over the last 7 days. */
  byKind: Record<FeedKind, number>
  /** Total across all kinds over the last 7 days. */
  total: number
  /** Total across all kinds in the last 24 hours. */
  today: number
}
