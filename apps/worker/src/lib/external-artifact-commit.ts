type ExternalArtifactCommit<T> = {
  write: () => Promise<void>
  persist: () => Promise<T>
  rollback: () => Promise<void>
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('External artifact operation failed')
}

/**
 * Commit an object-store artifact and its database reference as one compensated
 * operation. Object storage cannot participate in the database transaction, so
 * a failed write or persistence step must remove the uncommitted object.
 */
export async function commitExternalArtifact<T>(steps: ExternalArtifactCommit<T>): Promise<T> {
  try {
    await steps.write()
    return await steps.persist()
  } catch (error) {
    try {
      await steps.rollback()
    } catch (rollbackError) {
      throw new AggregateError(
        [asError(error), asError(rollbackError)],
        'External artifact commit and rollback both failed',
      )
    }
    throw error
  }
}
