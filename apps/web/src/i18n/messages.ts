import type { AppLocale } from '@beaconhs/i18n'
import { getAppMessages } from '@beaconhs/i18n/messages'

export function getMessagesForLocale(locale: AppLocale) {
  return getAppMessages(locale)
}
