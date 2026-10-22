import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./record-header-actions.tsx', import.meta.url), 'utf8')

function sheetSource(): string {
  const start = source.indexOf('const secondaryActions = (')
  const end = source.indexOf('\n  return (', start)
  if (start < 0 || end < 0) throw new Error('Could not locate the mobile sheet rows')
  return source.slice(start, end)
}

describe('record header actions menu contract', () => {
  it('uses one persistent action menu with destructive actions in its final section', () => {
    expect(source).toContain('<RecordActionMenu')
    expect(source).toContain('destructive={')
    expect(source).not.toContain('hidden items-center gap-2 sm:flex')
  })
  it('keeps the copy action and photo choice on the original server-action form', () => {
    const sheet = sheetSource()
    expect(sheet).toContain('<form action={copyAction}>')
    expect(sheet).toContain('offerPhotoCopy={offerPhotoCopy}')
    expect(source).toContain('const { pending } = useFormStatus()')
    expect(source).toContain("tGenerated('m_17f0584a533f66')")
  })
})

describe('record header actions submit contract', () => {
  it('confirms before running lock or unlock flows', () => {
    const lockForm = source.slice(
      source.indexOf('const lockForm = ('),
      source.indexOf('const secondaryActions ='),
    )

    expect(lockForm).toContain('<ConfirmedSubmitButton')
    expect(source).toContain(
      'void confirmDialog({ title, message, confirmLabel }).then(async (ok) => {',
    )
    expect(source).toContain('if (!ok) return')
    expect(source.indexOf('await flushRecordSaves()')).toBeLessThan(
      source.indexOf('button.form?.requestSubmit(button)'),
    )
  })

  it('translates the module-supplied lock label instead of rendering it raw', () => {
    expect(source).toContain('<GeneratedValue value={lockLabel} />')
    expect(source).not.toContain('<GeneratedValue value="Submit & lock" />')
  })
})
