import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getAppMessages, systemMessageKey } from '@beaconhs/i18n/messages'
import {
  collectClientMessageKeys,
  renderClientMessageKeys,
} from '../../scripts/generate-client-messages'
import { CLIENT_MESSAGE_KEYS } from './client-message-keys'
import { getClientMessages } from './client-messages'
import { FRONTLINE_ARTICLES } from '@/lib/manual/content/frontline'

it('keeps the client manifest complete when UI copy changes', () => {
  const keys = collectClientMessageKeys()
  expect(CLIENT_MESSAGE_KEYS).toEqual(keys)
  expect(readFileSync(new URL('./client-message-keys.ts', import.meta.url), 'utf8')).toBe(
    renderClientMessageKeys(keys),
  )
})

describe.each(['en', 'fr', 'es'] as const)('client translation payload: %s', (locale) => {
  it('preserves every active translation and namespace without the full guide catalogue', () => {
    const full = getAppMessages(locale)
    const selected = getClientMessages(full)
    const { Generated: fullGenerated, ...namespaces } = full
    const { Generated: clientGenerated, ...clientNamespaces } = selected
    expect(clientNamespaces).toEqual(namespaces)
    for (const key of CLIENT_MESSAGE_KEYS)
      expect(clientGenerated).toHaveProperty(key, fullGenerated[key as keyof typeof fullGenerated])
    for (const article of FRONTLINE_ARTICLES) {
      const key = systemMessageKey(article.body)
      expect(fullGenerated[key as keyof typeof fullGenerated]).toBeTypeOf('string')
      expect(clientGenerated).not.toHaveProperty(key)
    }
    expect(JSON.stringify(selected).length).toBeLessThan(JSON.stringify(full).length * 0.45)
    expect(JSON.stringify(selected).length).toBeLessThan(650_000)
    expect(getClientMessages(full)).toBe(selected)
  })
})
