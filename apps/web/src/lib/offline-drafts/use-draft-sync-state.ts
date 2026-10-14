'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { getDraftSyncEngine, type DraftSyncState } from './engine'

const noopSubscribe = () => () => {}
const getNullState = () => null

/** Live sync state for one draft key (null while disabled or unclaimed). */
export function useDraftSyncState(key: string | null): DraftSyncState | null {
  const subscribe = useCallback(
    (listener: () => void) => (key ? getDraftSyncEngine().subscribe(key, listener) : () => {}),
    [key],
  )
  const getState = useCallback(() => (key ? getDraftSyncEngine().getState(key) : null), [key])
  return useSyncExternalStore(
    key ? subscribe : noopSubscribe,
    key ? getState : getNullState,
    getNullState,
  )
}
