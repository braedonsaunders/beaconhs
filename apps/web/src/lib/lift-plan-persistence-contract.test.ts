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
})
