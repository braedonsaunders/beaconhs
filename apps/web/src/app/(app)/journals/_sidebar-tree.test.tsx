import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { WorkspaceData } from './_types'

vi.mock('./_heatmap', () => ({ Heatmap: () => null }))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  useGeneratedTranslations: () => (id: string) => id,
}))
import { SidebarTree } from './_sidebar-tree'
function render(canBrowseAll: boolean, canManage: boolean) {
  const data: WorkspaceData = {
    tree: [],
    treeHasMore: false,
    treeNextCursor: null,
    heatmap: [],
    counts: { total: 0, drafts: 0 },
    tagSuggestions: [],
    canReadAll: false,
    canBrowseAll,
    canManage,
    aiEnabled: false,
  }
  return renderToStaticMarkup(
    <SidebarTree
      data={data}
      groupBy="date"
      filters={{}}
      selectedId={null}
      onGroupByChange={vi.fn()}
      onFiltersChange={vi.fn()}
      onSelect={vi.fn()}
      onLoadMore={vi.fn()}
      onNewEntry={vi.fn()}
      onPickDate={vi.fn()}
    />,
  )
}
describe('mobile journal navigation', () => {
  it('gives scoped reviewers Records without Manage', () => {
    const html = render(true, false)
    expect(html).toContain('href="/journals/records"')
    expect(html).not.toContain('href="/journals/manage"')
  })
  it('keeps the two permissions separate for self-only workers and administrators', () => {
    expect(render(false, false)).not.toContain('/journals/records')
    expect(render(false, false)).not.toContain('/journals/manage')
    expect(render(true, true)).toContain('href="/journals/manage"')
  })
})
