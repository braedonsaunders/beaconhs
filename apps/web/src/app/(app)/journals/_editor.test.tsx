// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'

vi.mock('@/i18n/generated', () => ({
  GeneratedText: () => null,
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
vi.mock('./_voice-button', () => ({ VoiceButton: () => null }))
import { JournalEditor } from './_editor'

let root: Root
let container: HTMLDivElement
const change = vi.fn()
async function render(html: string, editable = true, key = 'entry-a') {
  await act(async () =>
    root.render(
      <JournalEditor
        key={key}
        initialHtml={html}
        editable={editable}
        aiEnabled={false}
        onChange={change}
      />,
    ),
  )
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  change.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('journal editor content ownership', () => {
  it('does not emit saves when loading, locking, or unlocking existing content', async () => {
    await render('<p>Saved journal</p>')
    expect(container.textContent).toContain('Saved journal')
    await render('<p>Saved journal</p>', false)
    await render('<p>Saved journal</p>')
    expect(change).not.toHaveBeenCalled()
  })

  it('keeps the live body through stale photo/metadata refreshes and loads a newly selected entry', async () => {
    await render('<ol><li>First 8 points</li></ol>')
    const editor = (container.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor
    await act(async () => {
      editor.commands.insertContentAt(
        editor.state.doc.content.size,
        '<p>Point 9</p><p>Point 10</p>',
      )
    })
    expect(change).toHaveBeenCalledOnce()
    expect(change.mock.calls[0]?.[0]).toContain('Point 10')
    change.mockClear()
    await render('<ol><li>First 8 points</li></ol>')
    expect(container.querySelector('.tiptap')!.textContent).toContain('Point 10')
    await render('<p>Another journal</p>', true, 'entry-b')
    expect(container.querySelector('.tiptap')!.textContent).toBe('Another journal')
    expect(change).not.toHaveBeenCalled()
  })
})
