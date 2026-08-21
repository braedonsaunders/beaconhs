import Link from 'next/link'
import type { ComponentProps } from 'react'

/**
 * Client-side link for file-download route handlers (CSV / XLSX / PDF).
 *
 * A plain `<a>` does a full document load and replays the boot splash. A
 * default `<Link>` stays in the app shell, but Next.js prefetches the href —
 * and those GETs run the export and write phantom audit rows.
 *
 * Always `prefetch={false}`. Use this instead of `<Link>` or `<a>` whenever
 * the href is an audited download route.
 */
export function DownloadLink(props: Omit<ComponentProps<typeof Link>, 'prefetch'>) {
  return <Link {...props} prefetch={false} />
}
