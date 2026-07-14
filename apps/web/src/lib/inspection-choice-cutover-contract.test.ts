import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('inspection configured response cutover contract', () => {
  it('authors and copies validated choices through banks and inspection types', () => {
    const editor = source('../components/builder/criterion-editors.tsx')
    const bankActions = source('../app/(app)/inspections/banks/_actions.ts')
    const typeActions = source('../app/(app)/inspections/types/_actions.ts')

    expect(editor).toContain('Options (one per line)')
    expect(editor).toContain('parseInspectionChoiceOptionsText')
    expect(bankActions).toContain('parseInspectionResponseConfig')
    expect(typeActions).toContain('choiceOptions: c.choiceOptions')
  })

  it('materialises immutable options and requires an exact configured selection', () => {
    const library = source('../app/(app)/inspections/_lib.ts')
    const page = source('../app/(app)/inspections/records/[id]/page.tsx')
    const card = source('../app/(app)/inspections/records/[id]/_criteria.tsx')

    expect(library).toContain('choiceOptionsSnapshot: r.criterion.choiceOptions')
    expect(library).toContain('(r.choiceOptionsSnapshot ?? []).includes(r.choiceAnswer)')
    expect(page).toContain('(criterion.choiceOptionsSnapshot ?? []).includes(choiceAnswer)')
    expect(page).toContain('isInspectionOutcomeResponseType(c.c.responseType) && !c.c.answer')
    expect(card).toContain('choiceOptions.map((option)')
    expect(card).toContain('actions.setChoiceAnswer')
  })

  it('surfaces saved choices in record reads, flows, PDFs, and the user guide', () => {
    const page = source('../app/(app)/inspections/records/[id]/page.tsx')
    const adapter = source('./flows/adapters/inspections.ts')
    const manual = source('./manual/content/frontline.ts')

    expect(page).toContain('choiceAnswer={row.c.choiceAnswer}')
    expect(adapter).toContain('inspectionCriterionDisplayAnswer')
    expect(adapter).toContain('choiceAnswer: inspectionRecordCriteria.choiceAnswer')
    expect(manual).toContain('**Select one**, **Text**, **Long text**, and **Number** items')
  })

  it('keeps text, long-text, and numeric answers typed across fill and read paths', () => {
    const page = source('../app/(app)/inspections/records/[id]/page.tsx')
    const card = source('../app/(app)/inspections/records/[id]/_criteria.tsx')
    const adapter = source('./flows/adapters/inspections.ts')

    expect(page).toContain('normalizeInspectionNumberAnswer')
    expect(page).toContain('textAnswer={row.c.textAnswer}')
    expect(page).toContain('numberAnswer={row.c.numberAnswer}')
    expect(card).toContain("responseType === 'long_text'")
    expect(card).toContain('actions.setValueAnswer')
    expect(adapter).toContain('textAnswer: inspectionRecordCriteria.textAnswer')
    expect(adapter).toContain('numberAnswer: inspectionRecordCriteria.numberAnswer')
  })
})
