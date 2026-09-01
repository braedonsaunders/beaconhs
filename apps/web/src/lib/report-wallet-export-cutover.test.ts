import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(resolve(import.meta.dirname, relative), 'utf8')

describe('wallet card report PDF cutover', () => {
  it('prints credential fronts from the PDF button and has no Wallet cards control', () => {
    const viewer = read('../app/(app)/reports/_viewer/viewer.client.tsx')
    const route = read('../app/(app)/reports/definitions/[id]/export/route.ts')
    const pdf = read('../../../../packages/forms-pdf/src/index.ts')
    const designRender = read('../../../../packages/forms-pdf/src/design-render.ts')
    expect(viewer).not.toContain('wallet-pdf')
    expect(viewer).not.toContain('CreditCard')
    expect(route).toContain('reportExportsCredentialFronts')
    expect(route).toContain("resolvedFormat === 'pdf'")
    expect(designRender).toContain('artboards?:')
    expect(designRender).toContain('pageSize?:')
    expect(pdf).toContain('renderWalletCardsForReport')
  })
})
