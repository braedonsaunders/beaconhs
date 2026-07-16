'use client'

import { createContext, useContext } from 'react'
import {
  DEFAULT_REGULATORY_TERMINOLOGY,
  type RegulatoryTerminology,
} from '@beaconhs/tenant/regulatory'

const RegulatoryTerminologyContext = createContext<RegulatoryTerminology>(
  DEFAULT_REGULATORY_TERMINOLOGY,
)

export function RegulatoryTerminologyProvider({
  value,
  children,
}: {
  value: RegulatoryTerminology
  children: React.ReactNode
}) {
  return (
    <RegulatoryTerminologyContext.Provider value={value}>
      {children}
    </RegulatoryTerminologyContext.Provider>
  )
}

export function useRegulatoryTerminology(): RegulatoryTerminology {
  return useContext(RegulatoryTerminologyContext)
}
