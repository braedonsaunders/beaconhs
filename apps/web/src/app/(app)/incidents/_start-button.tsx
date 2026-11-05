'use client'
import type { ReactNode } from 'react'
import { OnlineActionForm } from '@/components/online-action-form'
import { startIncident } from './_start'

export function StartIncidentForm({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <OnlineActionForm action={startIncident} purpose="start" className={className}>
      {children}
    </OnlineActionForm>
  )
}
