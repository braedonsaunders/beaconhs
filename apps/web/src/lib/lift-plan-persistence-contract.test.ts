import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const renderer = readFileSync(
  new URL('../app/(app)/apps/templates/[id]/fill/form-renderer.tsx', import.meta.url),
  'utf8',
)
const sketchPad = readFileSync(new URL('../components/sketch-pad.tsx', import.meta.url), 'utf8')

describe('lift-plan field persistence contract', () => {
  it('flushes the newest rich-text value on blur', () => {
    expect(renderer).toContain('latestValue.current = v')
    expect(renderer).toContain('onBlur={() => commit(latestValue.current)}')
    expect(renderer).not.toContain('onBlur={() => commit(value)}')
  })

  it('requires an explicit sketch save and persists it immediately', () => {
    expect(sketchPad).toContain(
      'onSave: (dataUrl: string | null, scene: SketchScene) => Promise<void>',
    )
    expect(sketchPad).toContain('async function saveDrawing()')
    expect(renderer).toContain("if (field.type === 'sketch')")
    expect(renderer).toContain(
      "persistValue={field.type === 'sketch' ? persistImmediately : undefined}",
    )
    expect(renderer).toContain('if (persistValue) await persistValue(next)')
  })

  it('uses the shared TipTap editor instead of contentEditable', () => {
    expect(renderer).toContain('RichTextEditor')
    expect(renderer).not.toContain('contentEditable')
    expect(renderer).not.toContain('execCommand')
  })

  it('opens the sketch canvas in a drawer instead of mounting Excalidraw inline', () => {
    expect(renderer).toContain('<Drawer')
    expect(renderer).toContain('m_0dac081b69dd88')
    expect(renderer).toContain("dynamic(() => import('@/components/sketch-pad')")
    expect(sketchPad).toContain('handleKeyboardGlobally={false}')
  })

  it('inserts tenant-authored symbols as editable canvas drafts, never auto-saved', () => {
    // Library comes from the sketch element config — no hard-coded shapes.
    expect(renderer).toContain('sketchConfigSchema.safeParse(field.config')
    expect(sketchPad).toContain('symbols?: SketchSymbol[]')
    expect(sketchPad).toContain('function insertSymbol(')
    expect(sketchPad).toContain('api.updateScene')
    // Fresh identity per insert so copies never collide with each other.
    expect(sketchPad).toContain('crypto.randomUUID()')
    // Insert path only marks dirty; the explicit save still persists.
    expect(sketchPad).toContain('async function saveDrawing()')
    expect(sketchPad).toContain('setDirty(true)')
  })

  it('gates AI diagram drafting behind config, permission, and human review', () => {
    // Server: permission + AI-config gates, validated primitives, no auto-draw.
    expect(renderer).toContain('draftSketchDiagram')
    const actions = readFileSync(
      new URL('../app/(app)/apps/templates/[id]/fill/actions.ts', import.meta.url),
      'utf8',
    )
    expect(actions).toContain("can(ctx, 'forms.ai.generate')")
    expect(actions).toContain('getTenantAiConfig(ctx)')
    expect(actions).toContain('generateSketchDraft(aiConfig,')
    // Client: draft inserts as editable elements; save stays explicit.
    expect(sketchPad).toContain('aiDraft?: {')
    expect(sketchPad).toContain('export function buildDraftElements(')
    expect(sketchPad).toContain('insertElements(buildDraftElements(result.elements))')
  })
})
