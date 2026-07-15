import { describe, expect, it } from 'vitest'
import { ringLattice } from './credential-theme'

describe('ringLattice', () => {
  it('encodes every fragment marker in the SVG data URL', () => {
    expect(ringLattice('##ffffff', 0.05)).not.toContain("stroke='#")
    expect(ringLattice('##ffffff', 0.05)).toContain("stroke='%23%23ffffff'")
  })
})
