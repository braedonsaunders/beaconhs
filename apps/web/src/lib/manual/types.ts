// The built-in user manual ("User guide"). Articles are code — plain-language
// markdown written for non-technical field workers — and permission-aware: an
// article is only visible when the reader could actually open the feature it
// describes (mirrors the nav registry's gates).
//
// AGENTS: when you add or change a user-facing feature you MUST update the
// matching article in ./content/* (see AGENTS.md "In-app user guide").

export const MANUAL_GROUP_ORDER = [
  'Getting started',
  'Everyday tasks',
  'Knowledge & training',
  'Equipment & PPE',
  'Oversight & reports',
  'Administration',
] as const

export type ManualGroup = (typeof MANUAL_GROUP_ORDER)[number]

export type ManualArticle = {
  /** Stable slug — the /help/[slug] URL. Never change once shipped. */
  slug: string
  title: string
  group: ManualGroup
  /** Key into the NavIcon ICONS map (components/sidebar-nav.tsx). */
  iconKey: string
  /** One plain sentence shown on the /help landing card. */
  summary: string
  /** Extra search terms, incl. trade slang ("truck log", "JSA", "FLHA"). */
  keywords: string[]
  /** Permission required to see the article (wildcard-aware, via can()). */
  requiredPermission?: string
  /** At least one of these permissions is required. */
  requiredAnyPermission?: string[]
  /**
   * Markdown body. Style: written for a construction crew, not an office.
   * Short sentences. Numbered steps. Bold the exact button/menu labels the
   * user will see. No technical jargon, no rhetorical questions.
   */
  body: string
}
