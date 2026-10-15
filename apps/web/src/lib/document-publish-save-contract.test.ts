import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const embed = readFileSync(new URL('../components/collabora-embed.tsx', import.meta.url), 'utf8')
const branding = readFileSync(
  new URL('../../../../deploy/collabora-branding.js', import.meta.url),
  'utf8',
)
const pane = readFileSync(
  new URL('../app/(app)/documents/[id]/_document-pane.tsx', import.meta.url),
  'utf8',
)
const page = readFileSync(new URL('../app/(app)/documents/[id]/page.tsx', import.meta.url), 'utf8')
const layout = readFileSync(
  new URL('../app/(app)/documents/[id]/layout.tsx', import.meta.url),
  'utf8',
)
const contents = readFileSync(
  new URL('../app/wopi/files/[fileId]/contents/route.ts', import.meta.url),
  'utf8',
)
const checkFile = readFileSync(
  new URL('../app/wopi/files/[fileId]/route.ts', import.meta.url),
  'utf8',
)

describe('document publish save contract', () => {
  it('asks Collabora to flush WOPI and waits for its explicit acknowledgment', () => {
    expect(embed).toContain("MessageId: 'Action_Save'")
    expect(embed).toContain('Notify: true')
    expect(embed).toContain("msg?.MessageId === 'Action_Save_Resp'")
    expect(embed).toContain('msg.Values?.success !== true')
    expect(embed).toContain("msg.Values.result === 'unmodified' && request.dirtyAtStart === true")
    expect(embed).toContain('The editor reloaded the stored file')
  })

  it('relayouts the iframe in pixels and restores the text caret', () => {
    expect(embed).toContain('new ResizeObserver')
    expect(embed).toContain("MessageId: 'BeaconHS_Relayout'")
    expect(embed).toContain("MessageId: 'Grab_Focus'")
    expect(branding).toContain('invalidateSize')
    expect(branding).toContain('nodeNeedsTheme')
    expect(branding).not.toContain('new MutationObserver(function () {\n    apply()\n  })')
  })

  it('keeps the editor mounted outside the page loading boundary', () => {
    expect(layout).toContain('DocumentEditorPortal')
    expect(page).toContain('id="document-editor-slot"')
    expect(page).not.toContain('<DocumentPane')
  })

  it('locks saves and does not treat a reformatted timestamp as a string conflict', () => {
    expect(checkFile).toContain('SupportsLocks: true')
    expect(contents).toContain('decideWopiPut')
    expect(contents).toContain('issueSaveTicket')
    expect(contents).not.toContain('clientStamp !== currentStamp')
  })

  it('does not snapshot a version until the metadata and editor saves complete', () => {
    const save = pane.indexOf('await editor.save()')
    // useOnlineAction pushes every mounted record's queued edits (the
    // Overview metadata) before it runs the step, and refuses offline.
    const metadataSave = pane.indexOf("await runOnline('finish', async () => {")
    const publish = pane.indexOf('await publishDocumentVersion(documentId, changelog)')
    expect(pane).toContain('const runOnline = useOnlineAction()')
    expect(save).toBeGreaterThanOrEqual(0)
    expect(metadataSave).toBeGreaterThanOrEqual(0)
    expect(metadataSave).toBeLessThan(save)
    expect(publish).toBeGreaterThan(save)
    // The Overview's record provider wraps the whole authoring workspace, so
    // its queued edits stay registered with the barrier on every tab.
    expect(layout).toContain('<OfflineRecordProvider module="documents" recordId={id}>')
  })

  it('keeps the document navigation rail from flex-shrinking during refresh', () => {
    expect(page).toMatch(/w-1\/3[^"\n]*shrink-0/u)
  })
})
