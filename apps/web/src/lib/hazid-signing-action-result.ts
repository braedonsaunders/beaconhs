import { unstable_rethrow } from 'next/navigation'
import { HazidSigningError, type SigningResult } from './hazid-signing-result'
export async function signingResult<T>(run: () => Promise<T>): Promise<SigningResult<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof HazidSigningError) return { ok: false, error: error.message }
    console.error('[hazid-signing] action failed', error)
    return {
      ok: false,
      error:
        'Could not save the signing change. Your work was not reported as complete. Try again.',
    }
  }
}
