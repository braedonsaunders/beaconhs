'use client'

// Tracks an in-app breadcrumb trail so a record page can send you back to where
// you actually came from — a person's transcript, a report, a list — instead of
// its one hardcoded "home". Every DetailHeader/PageHeader back link consults
// this via SmartBackLink, so the behaviour is app-wide with no per-page change.
//
// The trail is a linear drill-down stack (like a breadcrumb, not raw browser
// history): navigating to a URL already in the stack truncates back to it, so
// cycles collapse cleanly. It's a module-level external store read through
// useSyncExternalStore — no React state churn, and hydration-safe (the server
// snapshot is empty, so the first client render matches SSR, then upgrades).
// It persists in sessionStorage, so it survives a hard refresh within the tab
// and is naturally per-tab.

import { useEffect, useSyncExternalStore } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { backLabel, cleanTitle } from '@/lib/back-nav'

type Entry = { url: string; pathname: string; title: string | null }

const STORAGE_KEY = 'bhs:navstack'
const MAX_ENTRIES = 30

function readStack(): Entry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Module-level singleton: one trail per browser tab, shared by every back link.
let stack: Entry[] = readStack()
const listeners = new Set<() => void>()

// useSyncExternalStore requires a stable server snapshot (same reference every
// call) — an always-empty stack, so back links render their fallback on the
// server and the first client render, then upgrade after hydration.
const SERVER_SNAPSHOT: Entry[] = []

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function record(url: string, pathname: string, title: string | null): void {
  const existing = stack.findIndex((e) => e.url === url)
  if (existing >= 0) {
    // Returned to a page already in the trail — truncate to it and refresh its
    // title (metadata may have resolved since we last saw it).
    const next = stack.slice(0, existing + 1)
    next[existing] = { url, pathname, title: title ?? next[existing]!.title }
    stack = next
  } else {
    stack = [...stack, { url, pathname, title }]
    if (stack.length > MAX_ENTRIES) stack = stack.slice(stack.length - MAX_ENTRIES)
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack))
  } catch {
    // Private mode / quota — the trail just won't persist across reloads.
  }
  for (const cb of listeners) cb()
}

/** Records each in-app navigation. Renders nothing; mount once in the shell. */
export function NavHistoryTracker() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => {
    const url = search ? `${pathname}?${search}` : pathname
    const title = cleanTitle(typeof document !== 'undefined' ? document.title : null)
    record(url, pathname, title)
  }, [pathname, search])
  return null
}

/**
 * Best in-app return target that isn't the current page, or null. Walks the
 * trail backwards for the most recent entry on a DIFFERENT pathname — so tab
 * switches within a record don't become the back target; you return to the page
 * that led you here.
 */
export function useNavBack(currentPathname: string): { href: string; label: string } | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => stack,
    () => SERVER_SNAPSHOT,
  )
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const e = snapshot[i]!
    if (e.pathname !== currentPathname) {
      return { href: e.url, label: backLabel(e.url, e.title) }
    }
  }
  return null
}
