import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./record-header-actions.tsx', import.meta.url), 'utf8')

function sheetSource(): string {
  const start = source.indexOf('const secondaryActions = (')
  const end = source.indexOf('\n  return (', start)
  if (start < 0 || end < 0) throw new Error('Could not locate the mobile sheet rows')
  return source.slice(start, end)
}

describe('record header actions mobile sheet contract', () => {
  // Regression: the sheet used to close from its own container onClick. That
  // unmounts the copy <form> while the tap is still dispatching, and a browser
  // cancels submission of a disconnected form — "Copy" silently did nothing on
  // a phone, and people reached for the neighbouring "Submit & lock" instead.
  it('never closes the sheet from the container that wraps the copy form', () => {
    const container = source.slice(source.indexOf('bottom-[calc(0.75rem'))

    expect(container).not.toContain('onClick={() => setOpen(false)}')
    expect(source).toContain('{secondaryActions}')
  })

  it('closes the sheet from each navigating row instead', () => {
    const sheet = sheetSource()
    const rows = sheet.match(/<(?:Link|DownloadLink)\b/g) ?? []

    expect(rows.length).toBeGreaterThan(0)
    expect(sheet.match(/onClick=\{\(\) => setOpen\(false\)\}/g)).toHaveLength(rows.length)
  })

  it('keeps the copy form mounted and shows a pending state instead of closing', () => {
    const sheet = sheetSource()

    expect(sheet).toContain('<form action={copyAction}>')
    expect(sheet).toContain('<CopySubmit label={copyLabel} className={menuItem} iconSize={15} />')
    expect(source).toContain('const { pending } = useFormStatus()')
    expect(source).toContain("tGenerated('m_17f0584a533f66')")
  })
})

describe('record header actions submit contract', () => {
  it('confirms before running lock or unlock flows', () => {
    const lockForm = source.slice(
      source.indexOf('const lockForm = ('),
      source.indexOf('const menuItem ='),
    )

    expect(lockForm).toContain('<ConfirmedSubmitButton')
    expect(source).toContain('void confirmDialog({ title, message, confirmLabel }).then((ok) => {')
    expect(source).toContain('if (ok) button.form?.requestSubmit(button)')
  })

  it('translates the module-supplied lock label instead of rendering it raw', () => {
    expect(source).toContain('<GeneratedValue value={lockLabel} />')
    expect(source).not.toContain('<GeneratedValue value="Submit & lock" />')
  })
})
