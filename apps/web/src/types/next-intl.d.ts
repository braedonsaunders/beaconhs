import type { AppMessages } from '@beaconhs/i18n/messages'
import type { AppLocale } from '@beaconhs/i18n'

declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale
    Messages: AppMessages
  }
}
