/** Expected signing failures travel as data so production preserves useful messages. */
export class HazidSigningError extends Error {
  override readonly name = 'HazidSigningError'
}

export type SigningResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function unwrapSigningResult<T>(result: SigningResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}
