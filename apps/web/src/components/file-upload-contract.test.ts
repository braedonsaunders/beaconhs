import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./file-upload.tsx', import.meta.url), 'utf8')

describe('photo upload input contract', () => {
  it('accepts images without forcing a mobile device directly into its camera', () => {
    expect(source).toContain("variant === 'photo'\n      ? 'image/*'")
    expect(source).not.toMatch(/\bcapture=/)
  })
})
