// Convert legacy bespoke LessonBlock[] content into HTML so it loads straight
// into the TipTap editor (first save then persists it as RichDoc/contentHtml).
// Media blocks are dropped — the TipTap image flow replaces them.

import type { LessonBlock } from '@beaconhs/db/schema'
import { renderMd } from '../_lib/blocks'

export function blocksToHtml(blocks: LessonBlock[] | null | undefined): string {
  if (!blocks || blocks.length === 0) return ''
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const tag = b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3'
        out.push(`<${tag}>${escapeHtml(b.text)}</${tag}>`)
        break
      }
      case 'text':
        out.push(renderMd(b.md))
        break
      case 'callout':
        out.push(`<blockquote>${renderMd(b.md)}</blockquote>`)
        break
      case 'divider':
        out.push('<hr>')
        break
      default:
        break
    }
  }
  return out.join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
