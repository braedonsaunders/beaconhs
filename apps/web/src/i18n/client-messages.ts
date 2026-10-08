import type { AbstractIntlMessages } from 'next-intl'
import { CLIENT_MESSAGE_KEYS } from './client-message-keys'

const cache = new WeakMap<AbstractIntlMessages, AbstractIntlMessages>()

/** Serialize active lookup copy, while retaining the complete server translation catalogue. */
export function getClientMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const existing = cache.get(messages)
  if (existing) return existing
  const generated = messages.Generated
  const selected = {
    ...messages,
    Generated: Object.fromEntries(
      CLIENT_MESSAGE_KEYS.flatMap((key) =>
        generated && typeof generated === 'object' && generated[key] !== undefined
          ? [[key, generated[key]]]
          : [],
      ),
    ),
  }
  cache.set(messages, selected)
  return selected
}
