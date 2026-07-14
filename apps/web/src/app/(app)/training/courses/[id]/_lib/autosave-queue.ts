type AutosaveState = 'saved' | 'dirty' | 'saving' | 'error'

export type AutosaveSnapshot = {
  state: AutosaveState
  error: string | null
}

type SaveTask = {
  key: string
  sequence: number
  run: () => Promise<void>
}

type Listener = (snapshot: AutosaveSnapshot) => void

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'Save failed.'
}

/**
 * Debounces independent save channels while preserving their causal order.
 * Only one write can be in flight. A newer task for the same key replaces an
 * older pending task, and a failed latest task remains queued until retry.
 */
export class LatestAutosaveQueue {
  private readonly pending = new Map<string, SaveTask>()
  private readonly ready = new Set<string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private listener: Listener | null = null
  private running: SaveTask | null = null
  private draining: Promise<void> | null = null
  private failure: string | null = null
  private sequence = 0
  private paused = false

  subscribe(listener: Listener): () => void {
    this.listener = listener
    listener(this.snapshot())
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  schedule(key: string, delayMs: number, run: () => Promise<void>): void {
    if (this.paused) return
    const existingTimer = this.timers.get(key)
    if (existingTimer) clearTimeout(existingTimer)

    const task: SaveTask = {
      key,
      sequence: ++this.sequence,
      run,
    }
    this.pending.set(key, task)
    this.ready.delete(key)
    this.failure = null

    const timer = setTimeout(
      () => {
        this.timers.delete(key)
        if (this.pending.get(key) !== task) return
        this.ready.add(key)
        this.kick()
      },
      Math.max(0, delayMs),
    )
    this.timers.set(key, timer)
    this.emit()
  }

  hasWork(): boolean {
    return this.running !== null || this.pending.size > 0
  }

  async flush(): Promise<void> {
    await this.flushInternal()
  }

  async retry(): Promise<void> {
    await this.flushInternal()
  }

  /** Stop accepting edits, persist everything queued, and wait for quiescence. */
  async flushAndPause(): Promise<void> {
    this.paused = true
    await this.flushInternal()
  }

  /** Stop accepting edits and wait for the active write without starting pending work. */
  async pauseAndWait(): Promise<void> {
    this.paused = true
    this.clearTimers()
    this.ready.clear()
    this.emit()
    await this.draining
    this.ready.clear()
    this.emit()
  }

  resume(): void {
    this.paused = false
    this.emit()
  }

  private async flushInternal(): Promise<void> {
    this.clearTimers()
    for (const key of this.pending.keys()) this.ready.add(key)
    this.failure = null
    this.emit()
    await this.ensureDrain()
    if (this.failure) throw new Error(this.failure)
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private kick(): void {
    void this.ensureDrain()
  }

  private ensureDrain(): Promise<void> {
    if (this.draining) return this.draining
    const draining = this.drain().finally(() => {
      if (this.draining === draining) this.draining = null
      this.emit()
    })
    this.draining = draining
    return draining
  }

  private nextReadyTask(): SaveTask | null {
    let earliest: SaveTask | null = null
    for (const task of this.pending.values()) {
      if (!earliest || task.sequence < earliest.sequence) earliest = task
    }
    if (!earliest || !this.ready.has(earliest.key)) return null
    return earliest
  }

  private async drain(): Promise<void> {
    while (true) {
      const task = this.nextReadyTask()
      if (!task) return
      if (this.pending.get(task.key) !== task) continue

      this.pending.delete(task.key)
      this.ready.delete(task.key)
      this.running = task
      this.emit()
      try {
        await task.run()
      } catch (error) {
        this.running = null
        const newer = this.pending.get(task.key)
        if (newer && newer.sequence > task.sequence) {
          this.emit()
          continue
        }

        this.pending.set(task.key, task)
        this.ready.add(task.key)
        this.failure = errorMessage(error)
        this.emit()
        return
      }
      this.running = null
      this.failure = null
      this.emit()
    }
  }

  private snapshot(): AutosaveSnapshot {
    return {
      state: this.failure
        ? 'error'
        : this.running
          ? 'saving'
          : this.pending.size > 0
            ? 'dirty'
            : 'saved',
      error: this.failure,
    }
  }

  private emit(): void {
    this.listener?.(this.snapshot())
  }
}
