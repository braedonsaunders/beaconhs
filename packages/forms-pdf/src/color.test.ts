import { describe, expect, it } from 'vitest'
import { resolveHexColor } from './color'

describe('tenant branding colours', () => {
  it.each([' #7c3aed ', '#AbC', '#FFaa00'])('keeps a valid hex colour (%s)', (color) => {
    expect(resolveHexColor(color, '#0f172a')).toBe(color.trim())
  })
  it.each([undefined, null, '', ' ', '#ffff', 'not-a-colour', '#fff\";><script>'])(
    'rejects invalid branding before it reaches CSS (%s)',
    (color) => {
      expect(resolveHexColor(color, '#0f172a')).toBe('#0f172a')
    },
  )
})
