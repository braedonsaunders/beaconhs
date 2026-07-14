import { describe, expect, it, vi } from 'vitest'
import { generatedTemplateKey } from './template-key.server'

vi.mock('server-only', () => ({}))

describe('generatedTemplateKey', () => {
  it('keeps a readable canonical prefix and a full random suffix', () => {
    expect(generatedTemplateKey('  Daily Safety Review  ')).toMatch(
      /^daily_safety_review_[0-9a-f]{32}$/,
    )
  })

  it('falls back for symbol-only names and does not collide in a batch', () => {
    const keys = Array.from({ length: 100 }, () => generatedTemplateKey('***'))
    expect(new Set(keys)).toHaveLength(keys.length)
    expect(keys.every((key) => /^app_[0-9a-f]{32}$/.test(key))).toBe(true)
  })
})
