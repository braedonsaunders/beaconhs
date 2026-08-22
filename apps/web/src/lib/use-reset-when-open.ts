import { useEffect, useRef } from 'react'

/** Reset local drawer state when the drawer opens so leftover create values do not persist. */
export function useResetWhenOpen(open: boolean, reset: () => void): void {
  const resetRef = useRef(reset)
  useEffect(() => {
    resetRef.current = reset
  })
  useEffect(() => {
    if (open) resetRef.current()
  }, [open])
}
