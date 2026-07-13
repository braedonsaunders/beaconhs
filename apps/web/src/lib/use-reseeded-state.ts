'use client'

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * Local editable state that starts over when its owning resource changes.
 *
 * Unlike copying props in an effect, a new seed is visible on the same render
 * that receives it. Functional updates are applied to that current seed, so an
 * event cannot accidentally update a stale draft after a server refresh.
 */
export function useReseededState<T>(
  seedKey: unknown,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [snapshot, setSnapshot] = useState(() => ({ seedKey, value: initialValue }))
  const value = Object.is(snapshot.seedKey, seedKey) ? snapshot.value : initialValue

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (update) => {
      setSnapshot((current) => {
        const currentValue = Object.is(current.seedKey, seedKey) ? current.value : initialValue
        const nextValue =
          typeof update === 'function' ? (update as (previous: T) => T)(currentValue) : update
        if (Object.is(current.seedKey, seedKey) && Object.is(currentValue, nextValue))
          return current
        return { seedKey, value: nextValue }
      })
    },
    [initialValue, seedKey],
  )

  return [value, setValue]
}
