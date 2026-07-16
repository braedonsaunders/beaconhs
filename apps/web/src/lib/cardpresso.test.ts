import { describe, expect, it } from 'vitest'
import { buildCardPressoPrintXml } from './cardpresso-xml'

describe('cardPresso Web Print Server request', () => {
  it('escapes configuration and sends full-bleed PNG faces as image items', () => {
    const request = buildCardPressoPrintXml(
      {
        loginName: 'BEACON & ADMIN',
        loginPassword: '<password>',
        cardDocument: 'Beacon "Card".card',
        printer: 'Card Printer',
        frontItemId: 'BEACON_FRONT',
        backItemId: 'BEACON_BACK',
      },
      { front: Buffer.from('front'), back: Buffer.from('back') },
    )

    expect(request).toContain('<name>BEACON &amp; ADMIN</name>')
    expect(request).toContain('<password>&lt;password&gt;</password>')
    expect(request).toContain('filename="Beacon &quot;Card&quot;.card"')
    expect(request).toContain('<item id="BEACON_FRONT" type="image">ZnJvbnQ=</item>')
    expect(request).toContain('<item id="BEACON_BACK" type="image">YmFjaw==</item>')
  })
})
