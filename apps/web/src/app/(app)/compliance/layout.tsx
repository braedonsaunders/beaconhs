import type { ReactNode } from 'react'
import { ComplianceRefresh } from './_refresh'

export default function ComplianceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ComplianceRefresh />
      {children}
    </>
  )
}
