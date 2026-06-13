'use client'

// @beaconhs/ui stays framework-agnostic: it can't import next/link directly
// (a second module instance of next's router context in the transpiled
// package falls back to full-page anchor navigation). Instead the app
// provides its client-side <Link> once via UiLinkProvider, and ui components
// render UiLink — which uses it, or degrades to a plain <a>.

import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from 'react'

type LinkLike = ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>

const UiLinkContext = createContext<LinkLike | null>(null)

/** Mount once in the app shell with the framework's Link (e.g. next/link). */
export function UiLinkProvider({ link, children }: { link: LinkLike; children: ReactNode }) {
  return <UiLinkContext.Provider value={link}>{children}</UiLinkContext.Provider>
}

/** In-app anchor: client-side navigation when a Link is provided, <a> otherwise. */
export function UiLink({
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const Link = useContext(UiLinkContext) ?? 'a'
  return <Link href={href} {...rest} />
}
