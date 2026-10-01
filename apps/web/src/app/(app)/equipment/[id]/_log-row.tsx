'use client'

import type { ReactNode } from 'react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { TableRow } from '@beaconhs/ui'

export function EquipmentLogRow({ href, children }: { href?: string; children: ReactNode }) {
  const router = useRouter()
  return (
    <TableRow
      className={href ? 'cursor-pointer' : undefined}
      onClick={
        href
          ? (event) => {
              if (
                event.target instanceof Element &&
                event.target.closest('a,button,input,select,textarea')
              )
                return
              if (
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.altKey ||
                window.getSelection()?.toString()
              )
                return
              router.push(href as Route, { scroll: false })
            }
          : undefined
      }
    >
      {children}
    </TableRow>
  )
}
