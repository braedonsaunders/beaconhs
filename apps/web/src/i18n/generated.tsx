import { useMessages, useTranslations } from 'next-intl'
import { useCallback, type ReactNode } from 'react'
import type { AppMessages } from '@beaconhs/i18n/messages'
import { generatedMessageKey } from './generated-key'

export type GeneratedMessageKey = keyof AppMessages['Generated']
export type GeneratedMessageValues = Record<string, unknown>

export function useGeneratedTranslations() {
  const translate = useTranslations('Generated')
  return useCallback(
    (key: GeneratedMessageKey, values?: GeneratedMessageValues): string =>
      translate(key, values as never),
    [translate],
  )
}

export function useGeneratedValueTranslations() {
  const messages = useMessages() as { Generated?: Record<string, unknown> }
  const translate = useGeneratedTranslations()
  return useCallback(
    <Value,>(value: Value): Value => {
      if (typeof value !== 'string') return value
      const key = generatedMessageKey(value) as GeneratedMessageKey
      return (messages.Generated?.[key] === undefined ? value : translate(key)) as Value
    },
    [messages.Generated, translate],
  )
}

export function GeneratedText({
  id,
  values,
}: {
  id: GeneratedMessageKey
  values?: GeneratedMessageValues
}) {
  const translate = useGeneratedTranslations()
  return <>{translate(id, values)}</>
}

/** Translate a registry/config value when it is known system copy. */
export function GeneratedValue({ value }: { value: ReactNode }) {
  if (typeof value !== 'string') return <>{value}</>
  return <TranslatedGeneratedValue value={value} />
}

function TranslatedGeneratedValue({ value }: { value: string }) {
  const translateValue = useGeneratedValueTranslations()
  return <>{translateValue(value)}</>
}
