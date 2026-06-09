// Pure serializable types shared between server (queries/actions) and client
// (workspace UI). No runtime imports here so client components can import freely.

export type JournalStatus = 'draft' | 'submitted' | 'archived'
export type JournalDefinition = 'worker' | 'supervisor'
export type JournalAssignmentFrequency = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type GroupBy = 'date' | 'site' | 'topic' | 'person'

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'site', label: 'Site' },
  { value: 'topic', label: 'Topic' },
  { value: 'person', label: 'Person' },
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
  url: string | null
  caption: string | null
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

export type JournalOption = { id: string; name: string }

/** A tag offered in the entry picker — name + optional palette colour. */
export type TagSuggestion = { name: string; color: string | null }

export type WorkspaceCounts = {
  total: number
  drafts: number
  mine: number
}

export type WorkspaceData = {
  tree: TreeNode[]
  heatmap: HeatmapCell[]
  onThisDay: OnThisDayItem[]
  counts: WorkspaceCounts
  sites: JournalOption[]
  people: JournalOption[]
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
  mine?: boolean
  from?: string
  to?: string
}

export type EntryMetaResult = {
  summary: string
  tags: string[]
}

export type EntryPatch = {
  title?: string | null
  bodyHtml?: string
  definition?: JournalDefinition
  siteOrgUnitId?: string | null
  supervisorPersonId?: string | null
  entryDate?: string
}
