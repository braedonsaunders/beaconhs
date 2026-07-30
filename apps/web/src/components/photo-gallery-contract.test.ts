import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./photo-gallery.tsx', import.meta.url), 'utf8')

function photoEditorSource(): string {
  const start = source.indexOf('function PhotoEditor(')
  const end = source.indexOf('\nexport function PhotoGallery(', start)
  if (start < 0 || end < 0) throw new Error('Could not locate PhotoEditor')
  return source.slice(start, end)
}

describe('photo editor layout contract', () => {
  it('lets the image establish its intrinsic aspect ratio beneath the markup layer', () => {
    const editor = photoEditorSource()

    expect(editor).toContain('relative mx-auto w-fit max-w-full touch-none')
    expect(editor).toContain('width={photo.width ?? undefined}')
    expect(editor).toContain('height={photo.height ?? undefined}')
    expect(editor).toContain('block h-auto max-h-[60vh] w-auto max-w-full')
    expect(editor).toContain('object-contain select-none')
    expect(editor).not.toContain('object-fill')
    expect(editor).not.toContain('style={{ aspectRatio')
  })
})

describe('photo editor drawing contract', () => {
  it('tracks strokes synchronously and saves the current annotation buffer', () => {
    const editor = photoEditorSource()

    expect(editor).toContain('const annotationsRef = useRef<Annotation[]>')
    expect(editor).toContain('const activeStroke = useRef<number | null>(null)')
    expect(editor).toContain('activeStroke.current = annotationsRef.current.length')
    expect(editor).toContain('const drawing = activeStroke.current')
    expect(editor).toContain('annotations: annotationsRef.current')
  })

  it('does not leave saving blocked by a missed pointer-end event', () => {
    const editor = photoEditorSource()

    expect(editor).toContain('onLostPointerCapture={() => {')
    expect(editor).toContain('activeStroke.current = null')
    expect(editor).toContain('onClick={save} disabled={pending}')
    expect(editor).not.toContain('disabled={pending || drawing !== null}')
  })
})
