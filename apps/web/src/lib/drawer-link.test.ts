import { describe, expect, it } from 'vitest'
import { drawerLinkTarget } from './drawer-link'

const here = 'https://app.test/compliance/obligations?kind=training'

describe('drawerLinkTarget', () => {
  it('detects a link that opens a drawer on the current page', () => {
    expect(drawerLinkTarget('/compliance/obligations?kind=training&drawer=new', here)).toBe('new')
  })

  it('ignores other pages, other origins, and links without a new drawer', () => {
    expect(drawerLinkTarget('/compliance/due?drawer=new', here)).toBeNull()
    expect(
      drawerLinkTarget('https://other.test/compliance/obligations?drawer=new', here),
    ).toBeNull()
    expect(drawerLinkTarget('/compliance/obligations?kind=document', here)).toBeNull()
    expect(drawerLinkTarget('/compliance/obligations?drawer=new', `${here}&drawer=new`)).toBeNull()
    expect(drawerLinkTarget('http://[bad', here)).toBeNull()
  })
})
