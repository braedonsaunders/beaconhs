'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type UiTextTranslator = (value: string, values?: Readonly<Record<string, unknown>>) => string

const UiTextContext = createContext<UiTextTranslator>((value) => value)

/** Injects the host application's exact-copy translator into framework-agnostic UI primitives. */
export function UiTextProvider({
  translate,
  children,
}: {
  translate: UiTextTranslator
  children: ReactNode
}) {
  return <UiTextContext.Provider value={translate}>{children}</UiTextContext.Provider>
}

export function useUiText(): UiTextTranslator {
  return useContext(UiTextContext)
}
