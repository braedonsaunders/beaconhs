import type { AppLocale } from '@beaconhs/i18n'
import en from '../../messages/en.json'
import es from '../../messages/es.json'
import fr from '../../messages/fr.json'

const messagesByLocale = { en, es, fr }

export function getMessagesForLocale(locale: AppLocale) {
  return messagesByLocale[locale]
}
