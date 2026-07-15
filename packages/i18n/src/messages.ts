import type { AppLocale } from './index'
import en from './messages/en.json'
import es from './messages/es.json'
import fr from './messages/fr.json'
import { systemMessageKey } from './system-key'

export { systemMessageKey } from './system-key'

export type AppMessages = typeof en
type SystemMessageValues = Readonly<Record<string, unknown>>

const messagesByLocale = { en, es, fr } as const

export function getAppMessages(locale: AppLocale): AppMessages {
  return messagesByLocale[locale] as AppMessages
}

function formatSystemMessage(message: string, values: SystemMessageValues): string {
  let formatted = message.replace(/\{(value\d+)\}/g, (token, name: string) => {
    const value = values[name]
    return value === null || value === undefined ? token : String(value)
  })
  formatted = formatted.replace(/'(\{\{[^{}]+\}\})'/g, '$1')
  if (formatted.startsWith("'{") && formatted.endsWith("}'")) {
    formatted = formatted.slice(1, -1).replaceAll("''", "'")
  }
  return formatted
}

/** Translate known first-party copy; tenant/user-authored values pass through. */
export function translateSystemCopy(
  locale: AppLocale,
  source: string,
  values: SystemMessageValues = {},
): string {
  const key = systemMessageKey(source) as keyof AppMessages['Generated']
  const message = getAppMessages(locale).Generated[key]
  return formatSystemMessage(message ?? source, values)
}

export function createSystemTranslator(locale: AppLocale) {
  return (source: string, values?: SystemMessageValues) =>
    translateSystemCopy(locale, source, values)
}
