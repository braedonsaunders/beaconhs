import type en from '../../messages/en.json'
import type { AppLocale } from '@beaconhs/i18n'

declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale
    Messages: typeof en
  }
}
