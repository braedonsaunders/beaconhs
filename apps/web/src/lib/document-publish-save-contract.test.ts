import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const embed = readFileSync(new URL('../components/collabora-embed.tsx', import.meta.url), 'utf8')
const pane = readFileSync(
  new URL('../app/(app)/documents/[id]/_document-pane.tsx', import.meta.url),
  'utf8',
)
const page = readFileSync(new URL('../app/(app)/documents/[id]/page.tsx', import.meta.url), 'utf8')

describe('document publish save contract', () => {
  it('asks Collabora to flush WOPI and waits for its explicit acknowledgment', () => {
    expect(embed).toContain("MessageId: 'Action_Save'")
    expect(embed).toContain('Notify: true')
    expect(embed).toContain("msg?.MessageId === 'Action_Save_Resp'")
    expect(embed).toContain('msg.Values?.success === true')
  })

  it('does not snapshot a version until the editor save completes', () => {
    const save = pane.indexOf('await editor.save()')
    const publish = pane.indexOf('await publishDocumentVersion(documentId, changelog)')
    expect(save).toBeGreaterThanOrEqual(0)
    expect(publish).toBeGreaterThan(save)
  })

  it('keeps the document navigation rail from flex-shrinking during refresh', () => {
    expect(page).toMatch(/w-1\/3[^"\n]*shrink-0/u)
  })
})
