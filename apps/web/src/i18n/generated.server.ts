import { getMessages, getTranslations } from 'next-intl/server'
import type { GeneratedMessageKey, GeneratedMessageValues } from './generated'
import { generatedMessageKey } from './generated-key'

export async function getGeneratedTranslations() {
  const translate = await getTranslations('Generated')
  return (key: GeneratedMessageKey, values?: GeneratedMessageValues): string =>
    translate(key, values as never)
}

export async function getGeneratedValueTranslations() {
  const [messages, translate] = await Promise.all([
    getMessages() as Promise<{ Generated?: Record<string, unknown> }>,
    getGeneratedTranslations(),
  ])
  return <Value>(value: Value): Value => {
    if (typeof value !== 'string') return value
    const key = generatedMessageKey(value) as GeneratedMessageKey
    return (messages.Generated?.[key] === undefined ? value : translate(key)) as Value
  }
}

/** Resolve translated Markdown without ICU interpretation or a browser catalogue. */
export async function getGeneratedRawValueTranslations() {
  const messages = (await getMessages()) as { Generated?: Record<string, unknown> }
  return (value: string): string => {
    const translated = messages.Generated?.[generatedMessageKey(value)]
    return typeof translated === 'string' ? translated : value
  }
}
