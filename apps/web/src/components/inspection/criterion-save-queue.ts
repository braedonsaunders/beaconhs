/**
 * Chains a save after the previous one settles. A rejected save is still
 * surfaced to its caller, but cannot permanently block later edits.
 */
export function enqueueSerialTask(
  previous: Promise<void>,
  task: () => Promise<void>,
): Promise<void> {
  return previous.catch(() => undefined).then(task)
}
