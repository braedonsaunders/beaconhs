// Pure serializable types shared between server (queries/actions) and client
// (workspace UI). No runtime imports here so client components can import freely.

export type JournalStatus = 'draft' | 'submitted' | 'archived'
export type JournalDefinition = 'worker' | 'supervisor'
export const JOURNAL_ENTRY_TAG_LIMIT = 20
export const JOURNAL_TAG_NAME_LIMIT = 80
// The compose workspace is self-scoped (one author), so there is no "Person"
// grouping — cross-person browsing lives in /journals/records.
export type GroupBy = 'date' | 'site' | 'topic'

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'site', label: 'Location' },
  { value: 'topic', label: 'Topic' },
]

// A node in the auto-generated sidebar tree. Branch nodes have children;
// leaf nodes carry an `entryId` to open in the editor.
export type TreeNode = {
  key: string
  label: string
  count: number
  children?: TreeNode[]
  entryId?: string
  entryDate?: string
  draft?: boolean
  badge?: string
}

/** One bounded page of journal-tree leaves. Branches are rebuilt per page and
 * merged by key in the client as older entries are requested. */
export type TreePage = {
  nodes: TreeNode[]
  hasMore: boolean
  nextCursor: TreeCursor | null
}

export type TreeCursor = {
  asOf: string
  entryDate: string
  createdAt: string
  id: string
}

export type JournalListItem = {
  id: string
  reference: string
  title: string | null
  snippet: string
  entryDate: string
  status: JournalStatus
  definition: JournalDefinition
  siteName: string | null
  authorName: string | null
  tags: string[]
  photoCount: number
  thumbUrl: string | null
  updatedAt: string
}

export type JournalPhoto = {
  id: string
  attachmentId: string
  url: string | null
  caption: string | null
  annotations: import('@beaconhs/db/schema').Annotation[] | null
  width: number | null
  height: number | null
  filename: string
}

export type JournalEntryDetail = {
  id: string
  reference: string
  title: string | null
  bodyHtml: string
  bodyText: string
  summary: string | null
  entryDate: string
  status: JournalStatus
  definition: JournalDefinition
  siteOrgUnitId: string | null
  supervisorPersonId: string | null
  personId: string | null
  createdByTenantUserId: string | null
  tags: string[]
  photos: JournalPhoto[]
  authorName: string | null
  siteName: string | null
  updatedAt: string
  submittedAt: string | null
  locked: boolean
}

export type HeatmapCell = { date: string; count: number }
export type OnThisDayItem = {
  id: string
  entryDate: string
  title: string | null
  authorName: string | null
  snippet: string
  yearsAgo: number
}

/** Sort columns for the records list (URL `sort` param). */
export type JournalSort = 'date' | 'author' | 'site' | 'status' | 'reference'

/** Identifies a journal's author for the author-scoped workspace flyout. */
export type AuthorRef = {
  personId: string | null
  tenantUserId: string | null
  name?: string | null
}

/** Scoped status counts for the records list filter controls. */
export type JournalRecordsFacets = {
  statusCounts: Record<string, number>
}

/** A tag offered in the entry picker — name + optional palette colour. */
export type TagSuggestion = { name: string; color: string | null }

type WorkspaceCounts = {
  total: number
  drafts: number
}

export type WorkspaceData = {
  tree: TreeNode[]
  treeHasMore: boolean
  treeNextCursor: TreeCursor | null
  heatmap: HeatmapCell[]
  onThisDay: OnThisDayItem[]
  counts: WorkspaceCounts
  /** Tenant tags (used most-first, then defined-but-unused) — feeds tag autocomplete. */
  tagSuggestions: TagSuggestion[]
  canReadAll: boolean
  /** read.all OR read.site — may browse the records page (beyond own entries). */
  canBrowseAll: boolean
  canManage: boolean
  aiEnabled: boolean
}

export type JournalFilters = {
  q?: string
  site?: string
  person?: string
  tag?: string
  status?: JournalStatus
  definition?: JournalDefinition
  from?: string
  to?: string
}

export type EntryMetaResult = {
  summary: string
  tags: string[]
}

export type EntryPatch = {
  bodyHtml?: string
  definition?: JournalDefinition
  siteOrgUnitId?: string | null
  supervisorPersonId?: string | null
  entryDate?: string
  tags?: string[]
}
